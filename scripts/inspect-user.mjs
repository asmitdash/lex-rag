import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const email = process.argv[2]
const r = await client.query(`
  select p.id, p.email, p.role, p.account_type, p.default_workspace_id,
         w.kind as ws_kind, w.profession as ws_prof, w.name as ws_name,
         (select count(*) from workspace_members where user_id = p.id) as memberships
  from profiles p left join workspaces w on w.id = p.default_workspace_id
  where p.email = $1`, [email])
console.log(JSON.stringify(r.rows, null, 2))
await client.end()
