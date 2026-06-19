// Tool definitions + dispatch for the agentic multi-hop loop.
//
// Each tool is declared with a JSON schema (sent to Bedrock as the `tools`
// array) and a dispatch function that returns a string the planner sees as a
// tool_result. Keep the result strings small — they go back into context.

import type { Tool } from '../bedrock'
import { CorpusRetriever } from '../retrieval/corpus'
import { WebRetriever, browseUrl, webSearch } from '../retrieval/web'
import { GoogleGenAI } from '@google/genai'
import { withGeminiKey } from '../key-pool'
import { MODELS } from '../gemini'

export type ToolContext = {
  userId: string
  defaultTags?: string[]
}

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'search_corpus',
    description:
      "Search the user's private corpus + the public corpus using hybrid (BM25+vector) retrieval. " +
      'Use when the answer is likely in the user\'s uploaded documents.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, ideally rephrased for retrieval.' },
        k: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags to filter to a sub-corpus.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_web',
    description:
      'Search the live web (Brave; falls back to DuckDuckGo) and return titles + snippets + URLs. ' +
      'Use for current events, news, or anything outside the user\'s corpus.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        k: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
      },
      required: ['query'],
    },
  },
  {
    name: 'browse_url',
    description:
      'Fetch a single URL and return its main text (~12k chars max). Use to read a result from search_web more deeply.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    },
  },
  {
    name: 'expand_query',
    description:
      'Generate N alternative phrasings of a query for better retrieval recall. Returns a JSON array of strings.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        n: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
      },
      required: ['query'],
    },
  },
  {
    name: 'final_answer',
    description:
      'Emit the final answer when you have enough evidence. The answer must cite sources you have already retrieved using bracket numbers like [1], [2].',
    input_schema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The synthesized final answer with [n] citations.' },
      },
      required: ['answer'],
    },
  },
]

export type ToolHit = {
  source_type: 'corpus' | 'web'
  url?: string | null
  document_id?: string | null
  workspace_id?: string | null
  section?: string | null
  tags?: string[]
  content: string
  similarity?: number
  id?: string
}

export type DispatchResult = {
  text: string // shown back to the planner
  hits?: ToolHit[] // accumulated for citations
}

async function expandQuery(query: string, n: number): Promise<string[]> {
  const prompt =
    `Generate ${n} alternative phrasings of this query, one per line, for retrieval recall. ` +
    'Each phrasing should be a short standalone search query, not a paragraph. No numbering.\n\n' +
    `Query: ${query}`
  return withGeminiKey('chat', async key => {
    const client = new GoogleGenAI({ apiKey: key })
    const res = await client.models.generateContent({
      model: MODELS.chat,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3 },
    })
    const text = res.text ?? ''
    return text
      .split('\n')
      .map(l => l.replace(/^[\d\.\)\-\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, n)
  })
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<DispatchResult> {
  if (name === 'search_corpus') {
    const query = String(input.query ?? '')
    const k = Math.min(20, Math.max(1, Number(input.k ?? 8)))
    const tags = Array.isArray(input.tags) ? (input.tags as string[]) : ctx.defaultTags
    const r = new CorpusRetriever(ctx.userId)
    const chunks = await r.retrieve(query, k, { tags })
    const hits: ToolHit[] = chunks.map(c => ({
      source_type: 'corpus',
      url: c.url,
      document_id: c.document_id,
      workspace_id: c.workspace_id,
      section: c.section,
      tags: c.tags,
      content: c.content,
      similarity: c.similarity,
      id: c.id,
    }))
    const text = hits.length
      ? hits
          .map(
            (h, i) =>
              `[corpus#${i + 1}] ${h.section ?? ''}\n${h.content.slice(0, 600)}${
                h.content.length > 600 ? '…' : ''
              }`,
          )
          .join('\n\n---\n\n')
      : '(no corpus hits)'
    return { text, hits }
  }

  if (name === 'search_web') {
    const query = String(input.query ?? '')
    const k = Math.min(10, Math.max(1, Number(input.k ?? 6)))
    const results = await webSearch(query, k)
    const hits: ToolHit[] = results.map(r => ({
      source_type: 'web',
      url: r.url,
      content: `${r.title}\n${r.snippet}`,
    }))
    const text = results.length
      ? results.map((r, i) => `[web#${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
      : '(no web hits)'
    return { text, hits }
  }

  if (name === 'browse_url') {
    const url = String(input.url ?? '')
    if (!/^https?:\/\//.test(url))
      return { text: 'browse_url requires an http(s) URL' }
    try {
      const text = await browseUrl(url)
      const hits: ToolHit[] = [
        {
          source_type: 'web',
          url,
          content: text,
        },
      ]
      return {
        text: text.length > 4000 ? text.slice(0, 4000) + '…' : text,
        hits,
      }
    } catch (e) {
      return { text: `browse failed: ${(e as Error).message}` }
    }
  }

  if (name === 'expand_query') {
    const query = String(input.query ?? '')
    const n = Math.min(5, Math.max(1, Number(input.n ?? 3)))
    const out = await expandQuery(query, n)
    return { text: JSON.stringify(out) }
  }

  return { text: `unknown tool: ${name}` }
}

// Used by callers that need the WebRetriever shape (e.g. tests).
export const _internal = { WebRetriever }
