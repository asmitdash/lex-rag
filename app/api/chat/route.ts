import { NextResponse } from 'next/server'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'
import { embedQuery, generateAnswer } from '@/lib/gemini'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are LexRAG, a careful research assistant for Indian Chartered Accountants and Lawyers.

Rules:
- Answer ONLY using the RETRIEVED CONTEXT supplied by the user. If the context is insufficient, say so plainly.
- Cite the supporting passages inline using bracketed numbers like [1], [2] that map to the order of context items.
- Be precise about Indian statutes. Note that since July 2024 the criminal codes are BNS / BNSS / BSA (replacing IPC / CrPC / IEA). When the user references an old IPC section, also point to the BNS equivalent if visible in context.
- For tax questions, prefer the latest provisions in the Income Tax Act and CGST/IGST Acts as found in context.
- Never fabricate section numbers, case names, or citations. If you are not 100% sure, say "not found in your library."
- Keep answers tight: the lawyer or CA wants a direct, professional answer, not a lecture.`

type ChatBody = {
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const userId = userData.user.id

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  const role = (profile?.role ?? 'lawyer') as 'ca' | 'lawyer'

  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const message = body.message?.trim()
  if (!message) return NextResponse.json({ error: 'empty message' }, { status: 400 })

  const admin = getSupabaseAdmin()

  // Embed the query
  let queryVec: number[]
  try {
    queryVec = await embedQuery(message)
  } catch (e) {
    return NextResponse.json(
      { error: `embedding failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  // Retrieve top-k via RPC (respects role visibility)
  const { data: matches, error: rpcErr } = await admin.rpc('match_chunks', {
    query_embedding: toPgvector(queryVec),
    match_count: 8,
    user_id: userId,
    user_role: role,
  })
  if (rpcErr) {
    return NextResponse.json({ error: `retrieval failed: ${rpcErr.message}` }, { status: 500 })
  }

  type Match = {
    id: string
    document_id: string
    content: string
    section_meta: { section?: string } | null
    category: 'ca' | 'non_ca'
    similarity: number
  }
  const top = (matches ?? []) as Match[]

  // Pull document titles for citations
  const docIds = Array.from(new Set(top.map(m => m.document_id)))
  let titles = new Map<string, string>()
  if (docIds.length) {
    const { data: docs } = await admin
      .from('documents')
      .select('id, title')
      .in('id', docIds)
    titles = new Map((docs ?? []).map(d => [d.id, d.title]))
  }

  const contextStr = top
    .map((m, i) => {
      const title = titles.get(m.document_id) ?? 'Document'
      const sec = m.section_meta?.section ? ` — ${m.section_meta.section}` : ''
      return `[${i + 1}] ${title}${sec}\n${m.content}`
    })
    .join('\n\n---\n\n')

  // Build history (role mapping for Gemini: assistant -> model)
  const history = (body.history ?? [])
    .slice(-6) // last 6 turns max
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

  const citations = top.map(m => ({
    document_id: m.document_id,
    document_title: titles.get(m.document_id) ?? 'Document',
    section: m.section_meta?.section ?? null,
    category: m.category,
    similarity: m.similarity,
    snippet: m.content.length > 600 ? m.content.slice(0, 600) + '…' : m.content,
  }))

  return NextResponse.json({ answer, citations })
}

function toPgvector(v: number[]): string {
  return `[${v.join(',')}]`
}
