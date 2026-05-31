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

const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  console.log(`Applying ${file}...`)
  await client.query(sql)
  console.log(`  OK`)
}
await client.end()
console.log('All migrations applied')
