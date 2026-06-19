import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'
import { LibraryUI } from './library-ui'

export const dynamic = 'force-dynamic'

const PUBLIC_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'

export default async function LibraryPage() {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_type')
    .eq('id', userData.user!.id)
    .maybeSingle()

  const admin = getSupabaseAdmin()
  const { data: memberships } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userData.user!.id)
  const ids = (memberships ?? []).map(m => m.workspace_id as string)
  ids.push(PUBLIC_WORKSPACE_ID)

  const { data: docs } = await admin
    .from('documents')
    .select('id, title, tags, status, page_count, byte_size, error_message, created_at, workspace_id, owner_id')
    .in('workspace_id', ids)
    .order('created_at', { ascending: false })

  const enriched = (docs ?? []).map(d => ({
    ...d,
    visibility: d.workspace_id === PUBLIC_WORKSPACE_ID ? ('public' as const) : ('workspace' as const),
    mine: d.owner_id === userData.user!.id,
  }))

  return (
    <LibraryUI
      accountType={(profile?.account_type ?? 'personal') as 'personal' | 'company'}
      initialDocs={enriched}
    />
  )
}
