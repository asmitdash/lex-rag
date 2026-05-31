import { getSupabaseServer } from '@/lib/supabase/server'
import { LibraryUI } from './library-ui'

export const dynamic = 'force-dynamic'

export default async function LibraryPage() {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userData.user!.id)
    .maybeSingle()

  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, category, status, page_count, byte_size, error_message, created_at')
    .eq('owner_id', userData.user!.id)
    .order('created_at', { ascending: false })

  return <LibraryUI role={(profile?.role ?? 'lawyer') as 'ca' | 'lawyer'} initialDocs={docs ?? []} />
}
