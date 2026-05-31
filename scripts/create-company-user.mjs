import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

import { createClient } from '@supabase/supabase-js'
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const email = process.argv[2]
const password = process.argv[3]
const role = process.argv[4]
const accountType = process.argv[5]
const companyName = process.argv[6] || null

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: {
    role,
    account_type: accountType,
    full_name: 'Test User',
    company_name: companyName,
  },
})
if (error) {
  if (String(error.message).toLowerCase().includes('already')) {
    const { data: list } = await admin.auth.admin.listUsers()
    const existing = list.users.find(u => u.email === email)
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, {
        password,
        user_metadata: { role, account_type: accountType, full_name: 'Test User', company_name: companyName },
      })
      console.log(JSON.stringify({ id: existing.id, email, password, role, accountType, reused: true }))
      process.exit(0)
    }
  }
  console.error(error); process.exit(1)
}
console.log(JSON.stringify({ id: data.user.id, email, password, role, accountType }))
