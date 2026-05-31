-- Fix ambiguous column reference in match_chunks: when joining with workspace_members,
-- both tables expose `workspace_id`. Qualify everything explicitly.

drop function if exists public.match_chunks(vector, int, uuid, text);

create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count int,
  user_id uuid,
  user_role text
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_meta jsonb,
  category text,
  workspace_id uuid,
  similarity float
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member_workspaces uuid[];
begin
  select array_agg(m.workspace_id) into v_member_workspaces
  from public.workspace_members m where m.user_id = match_chunks.user_id;

  if v_member_workspaces is null then v_member_workspaces := array[]::uuid[]; end if;

  return query
  select
    c.id,
    c.document_id,
    c.content,
    c.section_meta,
    c.category,
    c.workspace_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where (
    c.workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
    or c.workspace_id = any (v_member_workspaces)
  )
  and (
    user_role = 'lawyer'
    or (user_role = 'ca' and c.category = 'ca')
  )
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
