-- Hotfix: hybrid_search returned numeric for rrf_score where the function
-- signature declared float (= double precision), causing Postgres to raise
-- "structure of query does not match function result type" at runtime.
--
-- Fix: explicit ::float8 cast on the fused score expression.

drop function if exists public.hybrid_search(vector, text, int, uuid, text[], int);

create or replace function public.hybrid_search(
  query_embedding vector(768),
  query_text text,
  match_count int,
  user_id uuid,
  filter_tags text[] default null,
  rrf_k int default 60
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_meta jsonb,
  tags text[],
  workspace_id uuid,
  vector_rank int,
  bm25_rank int,
  rrf_score float
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member_workspaces uuid[];
  v_query_ts tsquery;
begin
  select array_agg(m.workspace_id) into v_member_workspaces
  from public.workspace_members m where m.user_id = hybrid_search.user_id;
  if v_member_workspaces is null then v_member_workspaces := array[]::uuid[]; end if;

  v_query_ts := websearch_to_tsquery('english', coalesce(query_text, ''));

  return query
  with base as (
    select c.id, c.document_id, c.content, c.section_meta, c.tags, c.workspace_id,
           c.embedding, c.fts
    from public.chunks c
    where (
      c.workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
      or c.workspace_id = any (v_member_workspaces)
    )
    and (
      filter_tags is null
      or c.tags && filter_tags
    )
  ),
  vec as (
    select b.id,
           row_number() over (order by b.embedding <=> query_embedding) as rnk
    from base b
    order by b.embedding <=> query_embedding
    limit 50
  ),
  bm as (
    select b.id,
           row_number() over (order by ts_rank_cd(b.fts, v_query_ts) desc) as rnk
    from base b
    where v_query_ts is not null and b.fts @@ v_query_ts
    order by ts_rank_cd(b.fts, v_query_ts) desc
    limit 50
  ),
  fused as (
    select coalesce(vec.id, bm.id) as id,
           vec.rnk::int as vector_rank,
           bm.rnk::int as bm25_rank,
           (coalesce(1.0::float8 / (rrf_k + vec.rnk), 0::float8)
              + coalesce(1.0::float8 / (rrf_k + bm.rnk), 0::float8))::float8 as rrf_score
    from vec full outer join bm on bm.id = vec.id
  )
  select b.id, b.document_id, b.content, b.section_meta, b.tags, b.workspace_id,
         f.vector_rank, f.bm25_rank, f.rrf_score
  from fused f
  join base b on b.id = f.id
  order by f.rrf_score desc
  limit match_count;
end;
$$;

grant execute on function public.hybrid_search(vector, text, int, uuid, text[], int)
  to authenticated, service_role;
