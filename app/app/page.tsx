import { getSupabaseServer } from '@/lib/supabase/server'
import { ChatUI } from './chat-ui'

export const dynamic = 'force-dynamic'

export default async function ChatPage() {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()

  const { count } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userData.user!.id)
    .eq('status', 'ready')

  return <ChatUI docCount={count ?? 0} />
}
