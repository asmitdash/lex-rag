import { NextResponse } from 'next/server'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await getSupabaseServer()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const admin = getSupabaseAdmin()
  // Only the original uploader can delete (RLS would also block others, but we are using admin client).
  const { error } = await admin
    .from('documents')
    .delete()
    .eq('id', id)
    .eq('owner_id', userData.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
