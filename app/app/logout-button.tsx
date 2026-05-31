'use client'

import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/client'

export function LogoutButton() {
  const router = useRouter()
  const supabase = getSupabaseBrowser()
  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut()
        router.replace('/')
        router.refresh()
      }}
      className="w-full text-sm text-left px-3 py-2 rounded hover:bg-zinc-100"
    >
      Sign out
    </button>
  )
}
