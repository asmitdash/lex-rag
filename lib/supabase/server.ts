import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupaClient } from '@supabase/supabase-js'

export async function getSupabaseServer() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // server components can't set cookies; middleware handles refresh
          }
        },
      },
    },
  )
}

// service-role client for ingestion / RPC where we need to bypass RLS or use definer fn
export function getSupabaseAdmin() {
  return createSupaClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
