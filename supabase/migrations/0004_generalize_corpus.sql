-- Lex-Rag generalization: drop CA/Lawyer-specific surface, add domain-neutral
-- columns (tags, corpus_kind), add hybrid-search and contextual-retrieval
-- columns, replace match_chunks with role-free version, and add the
-- hybrid_search RPC (BM25 + vector with Reciprocal Rank Fusion).
--
-- Legacy `role`/`category` columns are kept (nullable) so the Jolly fork
-- continues to read its existing data through the legacy match_chunks signature
-- until it ships its own generalization.

-- ── Generic corpus columns ────────────────────────────────────────────────────

alter table public.documents
  add column if not exists tags text[] default '{}',
  add column if not exists corpus_kind text not null default 'user'
    check (corpus_kind in ('user', 'public', 'web_cache'));

alter table public.chunks
  add column if not exists tags text[] default '{}';

create index if not exists documents_tags_gin_idx on public.documents using gin (tags);
create index if not exists chunks_tags_gin_idx on public.chunks using gin (tags);

-- ── Drop NOT NULL on legacy role / category (keep columns for Jolly) ──────────

alter table public.profiles  alter column role drop not null;
alter table public.documents alter column category drop not null;
alter table public.chunks    alter column category drop not null;

-- ── Hybrid search: BM25 column ───────────────────────────────────────────────

alter table public.chunks
  add column if not exists fts tsvector
    generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists chunks_fts_idx on public.chunks using gin (fts);

-- ── Contextual retrieval (Anthropic-style) preamble cache ────────────────────

alter table public.chunks
  add column if not exists context_preamble text;

-- ── Replace match_chunks: drop user_role, accept optional tag filter ─────────
--
-- Note: we drop the OLD signature first. Jolly must continue using its frozen
-- migrations 0001-0003 in its own repo; on the shared DB we go with the new
-- shape. Anything calling the old signature will see PG raise function-not-found.

drop function if exists public.match_chunks(vector, int, uuid, text);

create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count int,
  user_id uuid,
  filter_tags text[] default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_meta jsonb,
  tags text[],
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
    c.tags,
    c.workspace_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where (
    c.workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
    or c.workspace_id = any (v_member_workspaces)
  )
  and (
    filter_tags is null
    or c.tags && filter_tags
  )
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ── Hybrid search: BM25 ⨉ vector with Reciprocal Rank Fusion (k=60) ──────────
--
-- Each leg pulls top-50 candidates, we fuse with the standard RRF score
--    score = Σ 1 / (k + rank_i)
-- and return top-`match_count`.

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

  -- websearch_to_tsquery handles user phrasing without erroring on punctuation
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
           coalesce(1.0 / (rrf_k + vec.rnk), 0)
             + coalesce(1.0 / (rrf_k + bm.rnk), 0) as rrf_score
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

grant execute on function public.match_chunks(vector, int, uuid, text[]) to authenticated, service_role;
grant execute on function public.hybrid_search(vector, text, int, uuid, text[], int) to authenticated, service_role;
