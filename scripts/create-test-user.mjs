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

const email = process.argv[2] || `test@example.com`
const password = process.argv[3] || 'TestPass123!'

// Try create; if exists, fetch and update password.
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: 'Test User' },
})

if (error) {
  if (String(error.message).toLowerCase().includes('already')) {
    const { data: list } = await admin.auth.admin.listUsers()
    const existing = list.users.find(u => u.email === email)
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, {
        password,
        user_metadata: { full_name: 'Test User' },
      })
      console.log(JSON.stringify({ id: existing.id, email, password, reused: true }))
    } else {
      console.error(error); process.exit(1)
    }
  } else {
    console.error(error); process.exit(1)
  }
} else {
  console.log(JSON.stringify({ id: data.user.id, email, password }))
}
