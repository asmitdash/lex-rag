import { NextResponse } from 'next/server'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'
import { embedQuery, generateAnswer } from '@/lib/gemini'
import { getRetriever, type RetrievedChunk } from '@/lib/retrieval'
import { runAgentLoop } from '@/lib/agent/loop'
import { judgeAnswer } from '@/lib/agent/judge'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are Lex-Rag, a careful research assistant.

Rules:
- Answer ONLY using the RETRIEVED CONTEXT supplied by the user. If the context is insufficient, say so plainly.
- Cite the supporting passages inline using bracketed numbers like [1], [2] that map to the order of context items.
- Never fabricate facts, numbers, dates, or citations. If you are not 100% sure, say "not in the available context."
- Keep answers tight and professional.`

type ChatBody = {
  message: string
  mode?: 'simple' | 'agent'
  corpus?: 'mine' | 'web' | 'both'
  tags?: string[]
  history?: { role: 'user' | 'assistant'; content: string }[]
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const userId = userData.user.id

  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const message = body.message?.trim()
  if (!message) return NextResponse.json({ error: 'empty message' }, { status: 400 })

  const mode = body.mode ?? 'simple'
  const corpusMode = body.corpus ?? 'mine'

  // ── Agent mode: hand off to multi-hop loop ────────────────────────────────
  if (mode === 'agent') {
    try {
      const result = await runAgentLoop({
        userId,
        question: message,
        corpus: corpusMode,
        tags: body.tags,
      })
      return NextResponse.json({
        answer: result.answer,
        citations: result.citations,
        hops: result.hops,
      })
    } catch (e) {
      return NextResponse.json(
        { error: `agent loop failed: ${(e as Error).message}` },
        { status: 500 },
      )
    }
  }

  // ── Simple mode: hybrid + rerank, then one-shot generate + critique ──────
  let queryVec: number[]
  try {
    queryVec = await embedQuery(message)
  } catch (e) {
    return NextResponse.json(
      { error: `embedding failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  const retriever = getRetriever(corpusMode, userId)
  let retrieved: RetrievedChunk[]
  try {
    retrieved = await retriever.retrieve(message, 8, {
      tags: body.tags,
      queryEmbedding: queryVec,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `retrieval failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  const admin = getSupabaseAdmin()
  const corpusIds = retrieved
    .filter(r => r.source_type === 'corpus' && r.document_id)
    .map(r => r.document_id as string)
  const titles = new Map<string, string>()
  if (corpusIds.length) {
    const { data: docs } = await admin
      .from('documents')
      .select('id, title')
      .in('id', Array.from(new Set(corpusIds)))
    for (const d of docs ?? []) titles.set(d.id as string, d.title as string)
  }

  const contextStr = retrieved
    .map((r, i) => {
      const title =
        r.source_type === 'web'
          ? r.url ?? 'Web result'
          : (r.document_id && titles.get(r.document_id)) ?? 'Document'
      const sec = r.section ? ` — ${r.section}` : ''
      return `[${i + 1}] ${title}${sec}\n${r.content}`
    })
    .join('\n\n---\n\n')

  const history = (body.history ?? [])
    .slice(-6)
    .map(h => ({
      role: (h.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      text: h.content,
    }))

  let answer: string
  try {
    answer = await generateAnswer({
      systemPrompt: SYSTEM_PROMPT,
      history,
      userMessage: message,
      context: contextStr,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `generation failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  // Self-critique: deterministic check + LLM judge if marginal.
  const verdict = await judgeAnswer({
    question: message,
    answer,
    chunks: retrieved.map(r => r.content),
  })

  const PUBLIC_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'
  const citations = retrieved.map(r => ({
    document_id: r.document_id ?? null,
    document_title:
      r.source_type === 'web'
        ? r.url ?? 'Web result'
        : (r.document_id && titles.get(r.document_id)) ?? 'Document',
    section: r.section ?? null,
    tags: r.tags ?? [],
    similarity: r.similarity ?? 0,
    visibility: r.workspace_id === PUBLIC_WORKSPACE_ID ? 'public' : 'workspace',
    source_type: r.source_type,
    source_url: r.url ?? null,
    snippet: r.content.length > 600 ? r.content.slice(0, 600) + '…' : r.content,
  }))

  return NextResponse.json({ answer, citations, verdict })
}
