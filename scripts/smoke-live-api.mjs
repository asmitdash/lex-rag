// Live-API smoke: signs up via Supabase auth client, hits /api/chat with a
// session cookie, asserts the API path doesn't 401/500.
//
// This depends on the deployed app having SUPABASE_SERVICE_ROLE_KEY set.
//
// Usage: node scripts/smoke-live-api.mjs https://lex-rag.vercel.app

import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })
import { createClient } from '@supabase/supabase-js'

const HOST = process.argv[2] ?? 'https://lex-rag.vercel.app'
console.log(`LIVE API SMOKE: ${HOST}`)

let failed = 0
function step(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  · ${detail}` : ''}`)
  if (!ok) failed++
}

// 1. Sign up via the deployed app's auth (uses anon/publishable key)
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY

const email = `live-${Date.now()}@gmail.com`
const password = 'asmitdash44-live'

// Bypass signUp email validation by creating via service role, then signing in
const adminPre = createClient(url, service, { auth: { persistSession: false } })
const { data: created, error: createErr } = await adminPre.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: 'Live Smoke' },
})
step('admin.createUser', !createErr && !!created?.user, createErr?.message ?? created?.user?.id ?? '?')
const userId = created?.user?.id

// Now sign in via the public client to get a real session token
const browser = createClient(url, anon, { auth: { persistSession: false } })
const { data: signinData, error: signinErr } = await browser.auth.signInWithPassword({
  email,
  password,
})
step('auth.signInWithPassword', !signinErr && !!signinData?.session, signinErr?.message ?? '?')

const token = signinData?.session?.access_token
step('access token', !!token, token ? `len=${token.length}` : 'no token')

if (!token) {
  process.exit(1)
}

// 3. Call /api/chat — this exercises the full server path: auth, RPC, Gemini.
//    We seed a tiny doc first via service-role so retrieval has something to find.
const admin = createClient(url, service, { auth: { persistSession: false } })
const PUBLIC_WS = '00000000-0000-0000-0000-000000000001'

// Create a profile row for the user (the trigger handle_new_user might not have run if confirmation is off)
await admin.from('profiles').upsert({ id: userId, email })

// Make sure user has a workspace membership entry
const { data: ws } = await admin.from('workspaces').insert({
  kind: 'personal',
  name: `${email}'s personal`,
  owner_id: userId,
}).select('id').single()
if (ws?.id) {
  await admin.from('workspace_members').insert({ workspace_id: ws.id, user_id: userId, role: 'owner' })
  await admin.from('profiles').update({ default_workspace_id: ws.id }).eq('id', userId)
}

// Seed a public corpus chunk
const { GoogleGenAI } = await import('@google/genai')
const keys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').filter(Boolean)
const gemini = new GoogleGenAI({ apiKey: keys[0] })

const passage = 'Mangoes are sweet. The Indian summer is hot. Lemons are sour and yellow.'
const e1 = await gemini.models.embedContent({
  model: 'gemini-embedding-001',
  contents: passage,
  config: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' },
})
const passageVec = e1.embeddings?.[0]?.values

const { data: doc } = await admin.from('documents').insert({
  owner_id: userId,
  workspace_id: PUBLIC_WS,
  title: 'Live Smoke — fruits',
  tags: ['smoke', 'live'],
  corpus_kind: 'public',
  source_type: 'pdf',
  status: 'ready',
  byte_size: 1234,
}).select('id').single()
await admin.from('chunks').insert({
  document_id: doc.id,
  owner_id: userId,
  workspace_id: PUBLIC_WS,
  tags: ['smoke'],
  chunk_index: 0,
  content: passage,
  embedding: `[${passageVec.join(',')}]`,
})

// Now call /api/chat with the user's bearer token
const chatRes = await fetch(`${HOST}/api/chat`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ message: 'What color are lemons?' }),
})
const chatBody = await chatRes.text()
step(
  'POST /api/chat',
  chatRes.status === 200,
  `HTTP ${chatRes.status} ${chatBody.slice(0, 200)}`,
)
let parsed = null
try {
  parsed = JSON.parse(chatBody)
} catch {}
if (parsed) {
  step(
    'chat returned answer',
    typeof parsed.answer === 'string' && parsed.answer.length > 0,
    parsed.answer ? parsed.answer.slice(0, 100) : '(no answer)',
  )
  step(
    'chat returned citations',
    Array.isArray(parsed.citations) && parsed.citations.length > 0,
    `${parsed.citations?.length ?? 0} citations`,
  )
}

// Cleanup
await admin.from('chunks').delete().eq('document_id', doc.id)
await admin.from('documents').delete().eq('id', doc.id)
if (ws?.id) {
  await admin.from('workspace_members').delete().eq('workspace_id', ws.id)
  await admin.from('workspaces').delete().eq('id', ws.id)
}
await admin.from('profiles').delete().eq('id', userId)
await admin.auth.admin.deleteUser(userId)
step('cleanup', true)

console.log(failed ? `\nFAILED ${failed} step(s)` : '\nALL GREEN')
process.exit(failed)
