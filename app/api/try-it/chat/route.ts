// Anonymous chat endpoint for /try-it. Retrieval is scoped to a single doc
// uploaded via /api/try-it/upload — no broader corpus, no web. Rate-limited
// per IP.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { embedQuery, generateAnswer } from '@/lib/gemini'
import { rerank } from '@/lib/retrieval/rerank'
import { judgeAnswer } from '@/lib/agent/judge'
import { checkLimit, clientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const ANON_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const DAY_MS = 24 * 60 * 60 * 1000

const SYSTEM_PROMPT = `You are Lex-Rag's demo assistant.

Rules:
- Answer ONLY using the RETRIEVED CONTEXT. If the context is insufficient, say "Not in the uploaded document."
- Cite the supporting passages inline using [1], [2] in the order shown.
- Never fabricate facts, numbers, dates, or quotes.
- Keep answers tight and professional.`

function toPgvector(v: number[]): string {
  return `[${v.join(',')}]`
}

type ChatBody = { message?: string; document_id?: string }

export async function POST(req: Request) {
  const ip = clientIp(req)
  const limit = checkLimit(`try-it:chat:${ip}`, 10, DAY_MS)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Rate limit reached. Sign up for unlimited use.' },
      { status: 429 },
    )
  }

  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const message = body.message?.trim()
  const docId = body.document_id?.trim()
  if (!message) return NextResponse.json({ error: 'empty message' }, { status: 400 })
  if (!docId) return NextResponse.json({ error: 'missing document_id' }, { status: 400 })

  const admin = getSupabaseAdmin()

  // Confirm doc belongs to the anon workspace (so the demo cannot leak others' data)
  const { data: doc } = await admin
    .from('documents')
    .select('id, title, workspace_id')
    .eq('id', docId)
    .maybeSingle()
  if (!doc || doc.workspace_id !== ANON_WORKSPACE_ID) {
    return NextResponse.json({ error: 'unknown document' }, { status: 404 })
  }

  let queryVec: number[]
  try {
    queryVec = await embedQuery(message)
  } catch (e) {
    return NextResponse.json(
      { error: `embedding failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  // Pull top-20 chunks for this doc by vector similarity (no role filter, no
  // hybrid — keep the demo path simple).
  const { data: chunks, error } = await admin
    .from('chunks')
    .select('id, content, section_meta, embedding')
    .eq('document_id', docId)
    .limit(200)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Rank by cosine vs query embedding (manual; chunks.embedding comes back as a string)
  const scored = (chunks ?? [])
    .map(c => {
      const raw = c.embedding as unknown as string
      const vec = parsePgvector(raw)
      return {
        id: c.id as string,
        content: c.content as string,
        section: ((c.section_meta as { section?: string } | null) ?? {}).section ?? null,
        score: vec ? cosine(queryVec, vec) : 0,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  const ranked = await rerank(
    message,
    scored.map(s => ({ id: s.id, text: s.content })),
  )
  const order = new Map(ranked.map((r, i) => [r.id, i]))
  const top = scored
    .slice()
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
    .slice(0, 6)

  const contextStr = top
    .map((c, i) => `[${i + 1}] ${doc.title}${c.section ? ` — ${c.section}` : ''}\n${c.content}`)
    .join('\n\n---\n\n')

  let answer: string
  try {
    answer = await generateAnswer({
      systemPrompt: SYSTEM_PROMPT,
      history: [],
      userMessage: message,
      context: contextStr,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `generation failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  const verdict = await judgeAnswer({
    question: message,
    answer,
    chunks: top.map(t => t.content),
  })

  const citations = top.map(t => ({
    document_title: doc.title as string,
    section: t.section,
    similarity: t.score,
    source_type: 'corpus' as const,
    source_url: null,
    snippet: t.content.length > 600 ? t.content.slice(0, 600) + '…' : t.content,
  }))

  return NextResponse.json({ answer, citations, verdict })
}

function parsePgvector(s: string): number[] | null {
  if (!s) return null
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      return JSON.parse(s) as number[]
    } catch {
      return null
    }
  }
  return null
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9)
}
