// Agentic multi-hop loop. Bedrock Claude Opus 4.7 is the planner and uses
// native tool-use. Maximum MAX_HOPS hops; the loop terminates when the model
// emits the `final_answer` tool call or hits the cap.
//
// Citations: every tool call that returned `hits` is accumulated into a
// citation pool. The final answer's bracket numbers are mapped back to the
// pool by simple order — the system prompt instructs the planner to cite
// using [1], [2], etc. as it sees them in tool results.

import { claudeMessages, type Message } from '../bedrock'
import { TOOL_DEFINITIONS, dispatchTool, type ToolHit } from './tools'

const MAX_HOPS = 5

type ContentText = { type: 'text'; text: string }
type ContentToolUse = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
type AssistantContent = ContentText | ContentToolUse

const SYSTEM = `You are Lex-Rag's research planner.

Your job: answer the user's question by calling tools to retrieve evidence,
then call \`final_answer\` with a synthesized answer that cites the evidence
inline using bracket numbers like [1], [2].

Rules:
- Always retrieve before answering. Don't answer from prior knowledge alone.
- Use \`search_corpus\` first when the user has uploaded documents that may contain the answer.
- Use \`search_web\` for current events, news, or anything outside the corpus.
- Use \`browse_url\` to read a specific result more deeply.
- Use \`expand_query\` if your initial retrieval returns weak hits.
- Cite using [1], [2] in the order tool results appeared.
- Keep the answer tight and professional. If evidence is insufficient, say so plainly.
- You have at most ${MAX_HOPS} tool hops before you MUST call \`final_answer\`.`

export type AgentResult = {
  answer: string
  citations: {
    document_id?: string | null
    document_title?: string
    section?: string | null
    tags?: string[]
    similarity?: number
    visibility?: 'public' | 'workspace' | 'web'
    source_type: 'corpus' | 'web'
    source_url?: string | null
    snippet: string
  }[]
  hops: number
}

export async function runAgentLoop(opts: {
  userId: string
  question: string
  corpus: 'mine' | 'web' | 'both'
  tags?: string[]
}): Promise<AgentResult> {
  const tools = TOOL_DEFINITIONS.filter(t => {
    if (opts.corpus === 'web' && t.name === 'search_corpus') return false
    if (opts.corpus === 'mine' && (t.name === 'search_web' || t.name === 'browse_url'))
      return false
    return true
  })

  const messages: Message[] = [
    {
      role: 'user',
      content: opts.question,
    },
  ]

  const citationPool: ToolHit[] = []
  let hops = 0
  let finalAnswer: string | null = null

  while (hops < MAX_HOPS && finalAnswer === null) {
    const resp = await claudeMessages({
      system: SYSTEM,
      messages,
      tools,
      max_tokens: 2048,
      temperature: 0,
    })

    const toolCalls = resp.content.filter(
      (c): c is ContentToolUse => c.type === 'tool_use',
    )
    const textParts = resp.content.filter((c): c is ContentText => c.type === 'text')

    if (resp.stop_reason !== 'tool_use' || toolCalls.length === 0) {
      // The planner gave a free-text answer without calling final_answer.
      finalAnswer = textParts.map(t => t.text).join('\n')
      break
    }

    // Append the assistant's tool_use turn
    messages.push({ role: 'assistant', content: resp.content as AssistantContent[] })

    // Run each tool and append a single user turn carrying all tool_results
    const userResults: {
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error?: boolean
    }[] = []
    for (const tc of toolCalls) {
      if (tc.name === 'final_answer') {
        finalAnswer = String(tc.input.answer ?? '')
        userResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: 'ok',
        })
        continue
      }
      try {
        const out = await dispatchTool(tc.name, tc.input, {
          userId: opts.userId,
          defaultTags: opts.tags,
        })
        if (out.hits) citationPool.push(...out.hits)
        userResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: out.text,
        })
      } catch (e) {
        userResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: `error: ${(e as Error).message}`,
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: userResults })

    hops += toolCalls.length

    if (finalAnswer !== null) break
  }

  if (finalAnswer === null) {
    finalAnswer =
      'I exhausted my retrieval budget before reaching a confident answer. ' +
      'Try narrowing the question or adding more documents to your library.'
  }

  const PUBLIC = '00000000-0000-0000-0000-000000000001'
  const citations = citationPool.map(h => ({
    document_id: h.document_id ?? null,
    document_title: h.url ?? '',
    section: h.section ?? null,
    tags: h.tags,
    similarity: h.similarity,
    visibility:
      h.source_type === 'web'
        ? ('web' as const)
        : h.workspace_id === PUBLIC
          ? ('public' as const)
          : ('workspace' as const),
    source_type: h.source_type,
    source_url: h.url ?? null,
    snippet: h.content.length > 600 ? h.content.slice(0, 600) + '…' : h.content,
  }))

  return { answer: finalAnswer, citations, hops }
}
