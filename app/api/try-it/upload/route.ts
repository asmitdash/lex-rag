// Anonymous upload endpoint for /try-it. Files go into a shared anonymous
// workspace (00000000-0000-0000-0000-000000000002) that is NOT exposed to
// authed users' search by default. We rate-limit per IP.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { extractPdfText } from '@/lib/pdf'
import { chunkText } from '@/lib/chunk'
import { embedBatch } from '@/lib/gemini'
import { contextualizeChunks } from '@/lib/retrieval/contextual'
import { checkLimit, clientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_BYTES = 4 * 1024 * 1024 + 400 * 1024
const ANON_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const ANON_OWNER_ID = '00000000-0000-0000-0000-000000000002'
const DAY_MS = 24 * 60 * 60 * 1000

function toPgvector(v: number[]): string {
  return `[${v.join(',')}]`
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  const limit = checkLimit(`try-it:upload:${ip}`, 5, DAY_MS)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Rate limit reached for /try-it uploads. Sign up for unlimited use.' },
      { status: 429 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'invalid form'
    return NextResponse.json({ error: msg }, { status: 413 })
  }
  const file = form.get('file') as File | null
  const title = (form.get('title') as string | null) ?? file?.name ?? 'Untitled'
  if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File over 4.4 MB' }, { status: 413 })
  }
  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'PDFs only' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const { data: doc, error: insErr } = await admin
    .from('documents')
    .insert({
      owner_id: ANON_OWNER_ID,
      workspace_id: ANON_WORKSPACE_ID,
      title,
      tags: ['anon', `ip:${ip}`],
      corpus_kind: 'user',
      source_type: 'pdf',
      status: 'processing',
      byte_size: file.size,
    })
    .select('id')
    .single()
  if (insErr || !doc)
    return NextResponse.json({ error: insErr?.message ?? 'insert failed' }, { status: 500 })
  const docId = doc.id as string

  const buf = Buffer.from(await file.arrayBuffer())
  try {
    const text = await extractPdfText(buf)
    if (!text || text.trim().length < 50) throw new Error('No extractable text in PDF')
    const chunks = chunkText(text)
    if (!chunks.length) throw new Error('No chunks produced')

    const contextual = await contextualizeChunks(title, text, chunks)

    const BATCH = 16
    let inserted = 0
    for (let i = 0; i < contextual.length; i += BATCH) {
      const slice = contextual.slice(i, i + BATCH)
      const vectors = await embedBatch(slice.map(c => `${c.preamble}\n\n${c.text}`))
      const rows = slice.map((c, j) => ({
        document_id: docId,
        owner_id: ANON_OWNER_ID,
        workspace_id: ANON_WORKSPACE_ID,
        tags: ['anon', `ip:${ip}`],
        chunk_index: i + j,
        content: c.text,
        context_preamble: c.preamble,
        section_meta: c.meta ?? null,
        embedding: toPgvector(vectors[j]),
      }))
      const { error: chunkErr } = await admin.from('chunks').insert(rows)
      if (chunkErr) throw new Error(`chunk insert failed: ${chunkErr.message}`)
      inserted += rows.length
    }

    await admin
      .from('documents')
      .update({
        status: 'ready',
        page_count: Math.max(1, Math.ceil(text.length / 3000)),
      })
      .eq('id', docId)

    return NextResponse.json({ id: docId, chunks: inserted })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    await admin.from('documents').update({ status: 'failed', error_message: msg }).eq('id', docId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
