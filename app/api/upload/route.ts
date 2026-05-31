import { NextResponse } from 'next/server'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'
import { extractPdfText } from '@/lib/pdf'
import { chunkText } from '@/lib/chunk'
import { embedBatch } from '@/lib/gemini'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB

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

  const form = await req.formData()
  const file = form.get('file') as File | null
  const title = (form.get('title') as string | null) ?? file?.name ?? 'Untitled'
  let category = (form.get('category') as 'ca' | 'non_ca' | null) ?? 'non_ca'
  // CA users can only upload CA-categorised docs (everything they own is CA).
  if (role === 'ca') category = 'ca'

  if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: 'file too large (max 25 MB)' }, { status: 400 })
  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf'))
    return NextResponse.json({ error: 'only PDFs are accepted in v0' }, { status: 400 })

  const admin = getSupabaseAdmin()

  // Insert doc as processing
  const { data: doc, error: insErr } = await admin
    .from('documents')
    .insert({
      owner_id: userId,
      title,
      category,
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
    if (!text || text.trim().length < 50) {
      throw new Error('No extractable text found in PDF')
    }
    const chunks = chunkText(text)
    if (!chunks.length) throw new Error('No chunks produced')

    // Embed in manageable batches to respect rate limits
    const BATCH = 16
    let inserted = 0
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH)
      const vectors = await embedBatch(slice.map(c => c.text))
      const rows = slice.map((c, j) => ({
        document_id: docId,
        owner_id: userId,
        category,
        chunk_index: i + j,
        content: c.text,
        section_meta: c.meta ?? null,
        embedding: toPgvector(vectors[j]),
      }))
      const { error: chunkErr } = await admin.from('chunks').insert(rows)
      if (chunkErr) throw new Error(`chunk insert failed: ${chunkErr.message}`)
      inserted += rows.length
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
  // Rough estimate: ~3000 chars per page
  return Math.max(1, Math.ceil(text.length / 3000))
}
