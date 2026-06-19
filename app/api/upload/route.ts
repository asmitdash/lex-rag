import { NextResponse } from 'next/server'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'
import { extractPdfText } from '@/lib/pdf'
import { chunkText } from '@/lib/chunk'
import { embedBatch } from '@/lib/gemini'
import { contextualizeChunks } from '@/lib/retrieval/contextual'
import { extractGraph, persistGraph } from '@/lib/graph/ingest'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_BYTES = 4 * 1024 * 1024 + 400 * 1024 // ~4.4 MB
const PUBLIC_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 16)
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const userId = userData.user.id

  const { data: profile } = await supabase
    .from('profiles')
    .select('default_workspace_id, account_type')
    .eq('id', userId)
    .maybeSingle()
  const myWorkspaceId = profile?.default_workspace_id as string | null
  if (!myWorkspaceId) {
    return NextResponse.json({ error: 'no workspace assigned' }, { status: 500 })
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
  const visibility = ((form.get('visibility') as string | null) ?? 'private').toLowerCase()
  const sourceUrl = (form.get('source_url') as string | null) ?? null
  const tags = parseTags(form.get('tags') as string | null)

  if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB. ` +
          `Vercel limits uploads to 4.5 MB on the current plan. Split this PDF or use a smaller version.`,
      },
      { status: 413 },
    )
  }
  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf'))
    return NextResponse.json({ error: 'only PDFs are accepted in v0' }, { status: 400 })

  const isPublic = visibility === 'public'
  const targetWorkspaceId = isPublic ? PUBLIC_WORKSPACE_ID : myWorkspaceId
  if (isPublic && (!sourceUrl || sourceUrl.trim().length < 8)) {
    return NextResponse.json(
      { error: 'Public corpus uploads require a source URL.' },
      { status: 400 },
    )
  }

  const admin = getSupabaseAdmin()

  const { data: doc, error: insErr } = await admin
    .from('documents')
    .insert({
      owner_id: userId,
      workspace_id: targetWorkspaceId,
      title,
      tags,
      corpus_kind: isPublic ? 'public' : 'user',
      source_type: isPublic ? 'url' : 'pdf',
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
    if (!text || text.trim().length < 50) {
      throw new Error('No extractable text found in PDF')
    }
    const chunks = chunkText(text)
    if (!chunks.length) throw new Error('No chunks produced')

    // Contextual retrieval (Anthropic-style): every chunk gets a 50-100 token
    // doc-context preamble before embedding. Best-effort; falls back to raw.
    const contextual = await contextualizeChunks(title, text, chunks)

    const BATCH = 16
    let inserted = 0
    const insertedIds: string[] = []
    for (let i = 0; i < contextual.length; i += BATCH) {
      const slice = contextual.slice(i, i + BATCH)
      const vectors = await embedBatch(slice.map(c => `${c.preamble}\n\n${c.text}`))
      const rows = slice.map((c, j) => ({
        document_id: docId,
        owner_id: userId,
        workspace_id: targetWorkspaceId,
        tags,
        chunk_index: i + j,
        content: c.text,
        context_preamble: c.preamble,
        section_meta: c.meta
          ? { ...c.meta, source_url: sourceUrl ?? undefined }
          : sourceUrl
          ? { source_url: sourceUrl }
          : null,
        embedding: toPgvector(vectors[j]),
      }))
      const { data: ins, error: chunkErr } = await admin
        .from('chunks')
        .insert(rows)
        .select('id')
      if (chunkErr) throw new Error(`chunk insert failed: ${chunkErr.message}`)
      inserted += rows.length
      for (const r of ins ?? []) insertedIds.push(r.id as string)
    }

    // GraphRAG: extract entities + edges in the background, store on the workspace.
    // Failure here must not fail the whole upload — graph layer is supplementary.
    try {
      const graph = await extractGraph(
        contextual.map((c, idx) => ({
          id: insertedIds[idx],
          text: c.text,
        })),
      )
      await persistGraph(admin, targetWorkspaceId, graph)
    } catch (graphErr) {
      console.warn('graph extraction failed:', graphErr)
    }

    await admin
      .from('documents')
      .update({ status: 'ready', page_count: estimatePages(text) })
      .eq('id', docId)

    return NextResponse.json({ id: docId, chunks: inserted, status: 'ready' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    await admin.from('documents').update({ status: 'failed', error_message: msg }).eq('id', docId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function toPgvector(v: number[]): string {
  return `[${v.join(',')}]`
}

function estimatePages(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3000))
}
