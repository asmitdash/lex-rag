-- GraphRAG layer.
--
-- Three tables:
--   entities          — nodes (typed, with embedding for semantic match)
--   edges             — typed relations between entities, optionally tying back to a chunk
--   entity_summaries  — cached community summaries (Louvain-clustered)
--
-- Workspace-scoped throughout. Public corpus uses workspace_id =
-- '00000000-0000-0000-0000-000000000001' just like documents/chunks.

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  type text not null,
  description text,
  embedding vector(768),
  created_at timestamptz not null default now(),
  unique (workspace_id, name, type)
);

create index if not exists entities_workspace_idx on public.entities (workspace_id);
create index if not exists entities_embedding_idx on public.entities using hnsw (embedding vector_cosine_ops);

create table if not exists public.edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  src uuid not null references public.entities(id) on delete cascade,
  dst uuid not null references public.entities(id) on delete cascade,
  relation text not null,
  weight float default 1.0,
  source_chunk_id uuid references public.chunks(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists edges_workspace_idx on public.edges (workspace_id);
create index if not exists edges_src_idx on public.edges (src);
create index if not exists edges_dst_idx on public.edges (dst);

create table if not exists public.entity_summaries (
  community_id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  level int not null default 0,
  summary text not null,
  member_ids uuid[] not null,
  refreshed_at timestamptz default now()
);

create index if not exists entity_summaries_workspace_idx
  on public.entity_summaries (workspace_id);

-- RLS — entities/edges/summaries are readable by workspace members and on the public corpus.
alter table public.entities         enable row level security;
alter table public.edges            enable row level security;
alter table public.entity_summaries enable row level security;

do $$ begin
  create policy entities_read on public.entities for select
    using (
      workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
      or workspace_id in (
        select wm.workspace_id from public.workspace_members wm where wm.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy edges_read on public.edges for select
    using (
      workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
      or workspace_id in (
        select wm.workspace_id from public.workspace_members wm where wm.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy entity_summaries_read on public.entity_summaries for select
    using (
      workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
      or workspace_id in (
        select wm.workspace_id from public.workspace_members wm where wm.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
