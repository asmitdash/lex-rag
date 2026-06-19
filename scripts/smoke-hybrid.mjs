// Smoke test the hybrid_search RPC against an existing seeded corpus.
// Usage: node scripts/smoke-hybrid.mjs "your query here"
import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const userEmail = process.argv[2]
const query = process.argv[3]
if (!userEmail || !query) {
  console.error('usage: node scripts/smoke-hybrid.mjs <user_email> "query"')
  process.exit(1)
}

const { data: list } = await admin.auth.admin.listUsers()
const u = list.users.find(x => x.email === userEmail)
if (!u) {
  console.error('no user with email', userEmail)
  process.exit(1)
}

const keys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').filter(Boolean)
const client = new GoogleGenAI({ apiKey: keys[0] })
const er = await client.models.embedContent({
  model: 'gemini-embedding-001',
  contents: query,
  config: { outputDimensionality: 768, taskType: 'RETRIEVAL_QUERY' },
})
const vec = er.embeddings?.[0]?.values
if (!vec) throw new Error('no embedding')

const { data, error } = await admin.rpc('hybrid_search', {
  query_embedding: `[${vec.join(',')}]`,
  query_text: query,
  match_count: 8,
  user_id: u.id,
  filter_tags: null,
})
if (error) {
  console.error('rpc failed:', error)
  process.exit(1)
}
console.log(JSON.stringify(data, null, 2).slice(0, 4000))
console.log(`\nOK · ${data.length} hits`)
