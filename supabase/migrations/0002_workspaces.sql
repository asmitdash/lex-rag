-- Workspaces: personal (1 user), company (multi-user via shared password — but we still
-- track who's in which workspace for retrieval), and the special 'public' workspace.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal','company','public')),
  -- profession applies for personal + company; null for the public workspace.
  profession text check (profession in ('ca','lawyer')),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- Single canonical public workspace. UUID is fixed so RPC and seeders can refer to it.
insert into public.workspaces (id, kind, profession, name, owner_id)
values ('00000000-0000-0000-0000-000000000001', 'public', null, 'Public Corpus', null)
on conflict (id) do nothing;

-- Extend profiles
alter table public.profiles add column if not exists account_type text
  check (account_type in ('personal','company')) default 'personal';
alter table public.profiles add column if not exists default_workspace_id uuid
  references public.workspaces(id) on delete set null;

-- Documents + chunks now scoped by workspace
alter table public.documents add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;
alter table public.chunks add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;

create index if not exists documents_workspace_idx on public.documents (workspace_id);
create index if not exists chunks_workspace_category_idx on public.chunks (workspace_id, category);

-- Backfill existing data: every owner gets a personal workspace, their docs/chunks move into it.
do $$
declare
  u record;
  wid uuid;
begin
  for u in
    select id, email, role, full_name from public.profiles
    where default_workspace_id is null
  loop
    insert into public.workspaces (kind, profession, name, owner_id)
    values ('personal', u.role, coalesce(u.full_name, split_part(u.email,'@',1)) || ' (personal)', u.id)
    returning id into wid;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (wid, u.id, 'owner')
    on conflict do nothing;

    update public.profiles set default_workspace_id = wid where id = u.id;
    update public.documents set workspace_id = wid where owner_id = u.id and workspace_id is null;
    update public.chunks    set workspace_id = wid where owner_id = u.id and workspace_id is null;
  end loop;
end $$;

-- Enforce non-null going forward
alter table public.documents alter column workspace_id set not null;
alter table public.chunks    alter column workspace_id set not null;

-- Replace handle_new_user to seed workspace + member + default_workspace_id
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'lawyer');
  v_account text := coalesce(new.raw_user_meta_data->>'account_type', 'personal');
  v_company_name text := new.raw_user_meta_data->>'company_name';
  v_full_name text := new.raw_user_meta_data->>'full_name';
  v_wid uuid;
begin
  insert into public.profiles (id, email, role, full_name, account_type)
  values (new.id, new.email, v_role, v_full_name, v_account)
  on conflict (id) do nothing;

  insert into public.workspaces (kind, profession, name, owner_id)
  values (
    v_account,
    v_role,
    case when v_account = 'company' and v_company_name is not null then v_company_name
         else coalesce(v_full_name, split_part(new.email,'@',1)) || ' (' || v_account || ')' end,
    new.id
  )
  returning id into v_wid;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_wid, new.id, 'owner');

  update public.profiles set default_workspace_id = v_wid where id = new.id;
  return new;
end;
$$;

-- Replace the retrieval RPC: pulls from (my workspace + public corpus), filtered by role.
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
  select array_agg(workspace_id) into v_member_workspaces
  from public.workspace_members where workspace_members.user_id = match_chunks.user_id;

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
    c.workspace_id = '00000000-0000-0000-0000-000000000001'
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

-- RLS: workspace-aware. A user can read documents in any workspace they're a member of,
-- plus everything in the public corpus.
drop policy if exists "documents owner read"   on public.documents;
drop policy if exists "documents owner write"  on public.documents;
drop policy if exists "documents owner update" on public.documents;
drop policy if exists "documents owner delete" on public.documents;

create policy "documents workspace read" on public.documents
  for select using (
    workspace_id = '00000000-0000-0000-0000-000000000001'
    or exists (select 1 from public.workspace_members m
               where m.workspace_id = documents.workspace_id and m.user_id = auth.uid())
  );
create policy "documents workspace write" on public.documents
  for insert with check (
    auth.uid() = owner_id and (
      workspace_id = '00000000-0000-0000-0000-000000000001'
      or exists (select 1 from public.workspace_members m
                 where m.workspace_id = documents.workspace_id and m.user_id = auth.uid())
    )
  );
create policy "documents owner delete" on public.documents
  for delete using (auth.uid() = owner_id);

drop policy if exists "chunks owner read"  on public.chunks;
drop policy if exists "chunks owner write" on public.chunks;
create policy "chunks workspace read" on public.chunks
  for select using (
    workspace_id = '00000000-0000-0000-0000-000000000001'
    or exists (select 1 from public.workspace_members m
               where m.workspace_id = chunks.workspace_id and m.user_id = auth.uid())
  );
create policy "chunks workspace write" on public.chunks
  for insert with check (auth.uid() = owner_id);

-- workspace_members: read your own memberships; admin manages.
alter table public.workspaces       enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "workspaces self read" on public.workspaces;
create policy "workspaces self read" on public.workspaces for select
  using (
    kind = 'public'
    or owner_id = auth.uid()
    or exists (select 1 from public.workspace_members m
               where m.workspace_id = workspaces.id and m.user_id = auth.uid())
  );

drop policy if exists "workspace_members self read" on public.workspace_members;
create policy "workspace_members self read" on public.workspace_members for select
  using (user_id = auth.uid());
