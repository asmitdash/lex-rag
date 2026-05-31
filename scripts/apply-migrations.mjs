import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })
const migrationsDir = join(__dirname, '..', 'supabase', 'migrations')

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL missing')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

await client.query(`create table if not exists public._migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
)`)

const { rows } = await client.query('select filename from public._migrations')
const applied = new Set(rows.map(r => r.filename))

const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
for (const file of files) {
  if (applied.has(file)) {
    console.log(`Skipping ${file} (already applied)`)
    continue
  }
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  console.log(`Applying ${file}...`)
  await client.query(sql)
  await client.query('insert into public._migrations (filename) values ($1)', [file])
  console.log(`  OK`)
}
await client.end()
console.log('All migrations applied')
