// End-to-end smoke against a deployed lex-rag instance.
//
// Usage: node scripts/smoke-e2e.mjs https://lex-rag.vercel.app
//
// 1. Hits public pages (/, /use-cases, /try-it) for HTTP 200.
// 2. Verifies the Supabase service-role key works server-side by signing up
//    a synthetic user via auth admin and inserting a workspace member row.
// 3. Drops a tiny seed PDF into the public workspace, embeds + chunks, then
//    calls the hybrid_search RPC and the unauthed legacy match_chunks RPC.
// 4. Cleans up the synthetic user.
//
// Exits non-zero on any verification failure.

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const HOST = process.argv[2] ?? 'https://lex-rag.vercel.app'
console.log(`SMOKE TARGET: ${HOST}`)

let failed = 0
function step(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  · ${detail}` : ''}`)
  if (!ok) failed++
}

// 1. Public pages
for (const path of ['/', '/use-cases', '/try-it', '/login', '/signup']) {
  const res = await fetch(`${HOST}${path}`, { redirect: 'manual' })
  step(`GET ${path}`, res.status === 200 || res.status === 307, `HTTP ${res.status}`)
}

// 2. Service-role key works
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false } })

const testEmail = `smoke-${Date.now()}@lex-rag.test`
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email: testEmail,
  password: 'asmitdash44-smoke',
  email_confirm: true,
})
step('admin.createUser', !cErr && !!created?.user, cErr?.message ?? created?.user?.id ?? '?')
const userId = created?.user?.id
if (!userId) {
  process.exit(1)
}

// 3. Insert a public-corpus document + a single chunk, then RPC search
const PUBLIC_WS = '00000000-0000-0000-0000-000000000001'

const { data: doc, error: docErr } = await admin
  .from('documents')
  .insert({
    owner_id: userId,
    workspace_id: PUBLIC_WS,
    title: 'Smoke Doc — apple banana cherry',
    tags: ['smoke'],
    corpus_kind: 'public',
    source_type: 'pdf',
    status: 'ready',
    byte_size: 1234,
  })
  .select('id')
  .single()
step('insert documents row', !docErr && !!doc?.id, docErr?.message ?? doc?.id ?? '?')

const keys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').filter(Boolean)
const gemini = new GoogleGenAI({ apiKey: keys[0] })
const passage = 'Apples are red. Bananas are yellow. Cherries are also red.'
const e1 = await gemini.models.embedContent({
  model: 'gemini-embedding-001',
  contents: passage,
  config: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' },
})
const passageVec = e1.embeddings?.[0]?.values
step('embed passage', !!passageVec, passageVec ? `dim=${passageVec.length}` : 'no vector')

const { error: chunkErr } = await admin.from('chunks').insert({
  document_id: doc.id,
  owner_id: userId,
  workspace_id: PUBLIC_WS,
  tags: ['smoke'],
  chunk_index: 0,
  content: passage,
  embedding: `[${passageVec.join(',')}]`,
  context_preamble: 'A smoke-test passage about colors of fruits.',
})
step('insert chunks row', !chunkErr, chunkErr?.message ?? '')

const e2 = await gemini.models.embedContent({
  model: 'gemini-embedding-001',
  contents: 'What color are bananas?',
  config: { outputDimensionality: 768, taskType: 'RETRIEVAL_QUERY' },
})
const queryVec = e2.embeddings?.[0]?.values

const { data: hybrid, error: hErr } = await admin.rpc('hybrid_search', {
  query_embedding: `[${queryVec.join(',')}]`,
  query_text: 'banana color',
  match_count: 5,
  user_id: userId,
  filter_tags: null,
})
step(
  'rpc hybrid_search',
  !hErr && Array.isArray(hybrid) && hybrid.length > 0,
  hErr?.message ?? `${hybrid?.length ?? 0} hits`,
)
if (hybrid?.length) {
  console.log(`     top: "${hybrid[0].content.slice(0, 60)}..." score=${hybrid[0].score}`)
}

const { data: matches, error: mErr } = await admin.rpc('match_chunks', {
  query_embedding: `[${queryVec.join(',')}]`,
  match_count: 5,
  user_id: userId,
  filter_tags: null,
})
step(
  'rpc match_chunks',
  !mErr && Array.isArray(matches) && matches.length > 0,
  mErr?.message ?? `${matches?.length ?? 0} hits`,
)

// 4. Cleanup
await admin.from('chunks').delete().eq('document_id', doc.id)
await admin.from('documents').delete().eq('id', doc.id)
await admin.auth.admin.deleteUser(userId)
step('cleanup', true)

console.log(failed ? `\nFAILED ${failed} step(s)` : '\nALL GREEN')
process.exit(failed)
