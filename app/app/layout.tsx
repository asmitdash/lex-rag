import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServer } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', userData.user.id)
    .maybeSingle()

  const role = (profile?.role ?? 'lawyer') as 'ca' | 'lawyer'

  return (
    <div className="flex flex-1 min-h-screen">
      <aside className="w-64 border-r border-zinc-200 bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-200">
          <Link href="/app" className="font-semibold tracking-tight">LexRAG</Link>
          <div className="mt-1 text-xs text-zinc-500 capitalize">
            {role === 'ca' ? 'Chartered Accountant' : 'Lawyer'} · {profile?.email}
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 text-sm">
          <Link href="/app" className="block px-3 py-2 rounded hover:bg-zinc-100">Chat</Link>
          <Link href="/app/library" className="block px-3 py-2 rounded hover:bg-zinc-100">Library</Link>
        </nav>
        <div className="p-3 border-t border-zinc-200">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  )
}
