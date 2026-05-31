// Seed the public corpus with the two test PDFs (BNS + IT Act excerpts).
// Uses the same ingestion pipeline as the upload route: extract -> chunk -> embed -> insert.
// Idempotent-ish: deletes prior `Public Corpus Seed` documents before re-inserting.

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const PUBLIC_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'
const EMBED_DIM = 768

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const keys = (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? '')
  .split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
if (!keys.length) { console.error('no Gemini keys'); process.exit(1) }
let keyIdx = 0
function nextKey() {
  const k = keys[keyIdx % keys.length]
  keyIdx++
  return k
}

async function withRetry(fn) {
  let lastErr = null
  for (let i = 0; i < keys.length + 2; i++) {
    try { return await fn(nextKey()) }
    catch (e) { lastErr = e }
  }
  throw lastErr
}

async function extract(buf) {
  return withRetry(async key => {
    const ai = new GoogleGenAI({ apiKey: key })
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [
        { inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' } },
        { text: 'Extract the full text. Preserve section/chapter headings exactly.' },
      ]}],
      config: { temperature: 0 },
    })
    return res.text ?? ''
  })
}

async function embed(text) {
  return withRetry(async key => {
    const ai = new GoogleGenAI({ apiKey: key })
    const res = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: text,
      config: { outputDimensionality: EMBED_DIM, taskType: 'RETRIEVAL_DOCUMENT' },
    })
    return res.embeddings[0].values
  })
}

const SECTION_RE = /^(?:\s*)(?:section|sec\.|chapter|chap\.|article|art\.|clause)\s+\d+[A-Z]?\b.*$/im
function chunkText(raw, fallbackSize = 1200, overlap = 150) {
  const text = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return []
  const lines = text.split('\n')
  const sections = []
  let current = { body: [] }
  for (const line of lines) {
    if (SECTION_RE.test(line)) {
      if (current.body.length || current.header) sections.push(current)
      current = { header: line.trim(), body: [] }
    } else current.body.push(line)
  }
  if (current.body.length || current.header) sections.push(current)
  const chunks = []
  const usingSections = sections.some(s => s.header)
  if (usingSections) {
    for (const s of sections) {
      const blob = [s.header, ...s.body].filter(Boolean).join('\n').trim()
      if (!blob) continue
      if (blob.length <= fallbackSize * 1.5) {
        chunks.push({ text: blob, meta: s.header ? { section: s.header } : undefined })
      } else {
        for (let i = 0; i < blob.length; i += fallbackSize - overlap) {
          chunks.push({ text: blob.slice(i, i + fallbackSize), meta: s.header ? { section: s.header } : undefined })
        }
      }
    }
  } else {
    for (let i = 0; i < text.length; i += fallbackSize - overlap)
      chunks.push({ text: text.slice(i, i + fallbackSize) })
  }
  return chunks.filter(c => c.text.trim().length > 30)
}

const SEEDS = [
  {
    title: 'BNS 2023 — Sample sections (Section 101, 103, 117) — Public Corpus Seed',
    category: 'non_ca',
    source_url: 'https://www.indiacode.nic.in/handle/123456789/20098',
    file: 'C:/tmp/test_bns.pdf',
  },
  {
    title: 'Income Tax Act 1961 — Sample sections (143(2), 148, 80C) — Public Corpus Seed',
    category: 'ca',
    source_url: 'https://incometaxindia.gov.in/Pages/acts/income-tax-act.aspx',
    file: 'C:/tmp/test_it_act.pdf',
  },
]

async function seedAdminUserId() {
  const { data } = await admin.auth.admin.listUsers()
  const u = data.users.find(u => u.email === 'lawyer-test@example.com')
  if (!u) throw new Error('no admin owner found')
  return u.id
}

async function main() {
  const ownerId = await seedAdminUserId()
  // Wipe previous seeds
  await admin.from('documents').delete()
    .eq('workspace_id', PUBLIC_WORKSPACE_ID)
    .like('title', '%Public Corpus Seed%')

  for (const s of SEEDS) {
    console.log(`Seeding: ${s.title}`)
    const buf = readFileSync(s.file)
    const text = await extract(buf)
    const chunks = chunkText(text)
    if (!chunks.length) { console.log('  no chunks'); continue }

    const { data: doc, error } = await admin.from('documents').insert({
      owner_id: ownerId,
      workspace_id: PUBLIC_WORKSPACE_ID,
      title: s.title,
      category: s.category,
      source_type: 'url',
      status: 'processing',
      byte_size: buf.length,
    }).select('id').single()
    if (error) { console.error('  doc insert', error); continue }

    const rows = []
    for (let i = 0; i < chunks.length; i++) {
      const v = await embed(chunks[i].text)
      rows.push({
        document_id: doc.id,
        owner_id: ownerId,
        workspace_id: PUBLIC_WORKSPACE_ID,
        category: s.category,
        chunk_index: i,
        content: chunks[i].text,
        section_meta: { ...(chunks[i].meta ?? {}), source_url: s.source_url },
        embedding: `[${v.join(',')}]`,
      })
    }
    const { error: cErr } = await admin.from('chunks').insert(rows)
    if (cErr) { console.error('  chunk insert', cErr); continue }
    await admin.from('documents').update({ status: 'ready', page_count: 1 }).eq('id', doc.id)
    console.log(`  inserted ${rows.length} chunks`)
  }
  console.log('Public corpus seeded.')
}

main().catch(e => { console.error(e); process.exit(1) })
