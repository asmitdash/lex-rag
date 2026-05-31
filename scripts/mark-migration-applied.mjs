import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query(`create table if not exists public._migrations (filename text primary key, applied_at timestamptz not null default now())`)
const args = process.argv.slice(2)
for (const f of args) {
  await client.query('insert into public._migrations (filename) values ($1) on conflict do nothing', [f])
  console.log('marked', f)
}
await client.end()
