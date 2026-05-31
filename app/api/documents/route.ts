import { NextResponse } from 'next/server'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const PUBLIC_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'

export async function GET() {
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Use admin to bypass RLS for the workspace lookup; we still scope by user identity.
  const admin = getSupabaseAdmin()
  const { data: memberships } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userData.user.id)
  const ids = (memberships ?? []).map(m => m.workspace_id as string)
  ids.push(PUBLIC_WORKSPACE_ID)

  const { data, error } = await admin
    .from('documents')
    .select('id, title, category, status, page_count, byte_size, error_message, created_at, workspace_id, owner_id')
    .in('workspace_id', ids)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    documents: (data ?? []).map(d => ({
      ...d,
      visibility: d.workspace_id === PUBLIC_WORKSPACE_ID ? 'public' : 'workspace',
      mine: d.owner_id === userData.user!.id,
    })),
  })
}
