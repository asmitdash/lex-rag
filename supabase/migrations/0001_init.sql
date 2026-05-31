-- Enable pgvector
create extension if not exists vector;

-- Profiles: role per user (ca or lawyer)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('ca','lawyer')),
  full_name text,
  created_at timestamptz not null default now()
);

-- Documents: one row per uploaded file (or future scraped URL)
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null check (category in ('ca','non_ca')),
  source_type text not null default 'pdf' check (source_type in ('pdf','url','text')),
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  page_count int,
  byte_size int,
  error_message text,
  created_at timestamptz not null default now()
);

-- Chunks: text + 768-dim Gemini embeddings
create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('ca','non_ca')),
  chunk_index int not null,
  content text not null,
  section_meta jsonb,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists chunks_owner_category_idx on public.chunks (owner_id, category);
create index if not exists chunks_document_idx on public.chunks (document_id);
create index if not exists chunks_embedding_idx on public.chunks
  using hnsw (embedding vector_cosine_ops);

-- Chats + messages
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  citations jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id, created_at);

-- Auto-create profile on signup; role+name come from raw_user_meta_data
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'lawyer'),
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles  enable row level security;
alter table public.documents enable row level security;
alter table public.chunks    enable row level security;
alter table public.chats     enable row level security;
alter table public.messages  enable row level security;

-- profiles: read/update own
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- documents: per-owner read; CA role can only see ca, lawyers see both.
-- enforced in app via role check + here via owner_id match
drop policy if exists "documents owner read"   on public.documents;
drop policy if exists "documents owner write"  on public.documents;
drop policy if exists "documents owner update" on public.documents;
drop policy if exists "documents owner delete" on public.documents;
create policy "documents owner read"   on public.documents for select using (auth.uid() = owner_id);
create policy "documents owner write"  on public.documents for insert with check (auth.uid() = owner_id);
create policy "documents owner update" on public.documents for update using (auth.uid() = owner_id);
create policy "documents owner delete" on public.documents for delete using (auth.uid() = owner_id);

-- chunks: same shape; category visibility enforced server-side via service role queries
drop policy if exists "chunks owner read"  on public.chunks;
drop policy if exists "chunks owner write" on public.chunks;
create policy "chunks owner read"  on public.chunks for select using (auth.uid() = owner_id);
create policy "chunks owner write" on public.chunks for insert with check (auth.uid() = owner_id);

-- chats + messages: owner only
drop policy if exists "chats owner all"    on public.chats;
drop policy if exists "messages owner all" on public.messages;
create policy "chats owner all"    on public.chats    for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "messages owner all" on public.messages for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Vector search RPC: respects role visibility (CA sees ca; lawyer sees both)
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
  similarity float
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    c.id,
    c.document_id,
    c.content,
    c.section_meta,
    c.category,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where c.owner_id = user_id
    and (
      user_role = 'lawyer'
      or (user_role = 'ca' and c.category = 'ca')
    )
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Storage bucket for raw PDFs (private)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents bucket owner read"   on storage.objects;
drop policy if exists "documents bucket owner write"  on storage.objects;
drop policy if exists "documents bucket owner delete" on storage.objects;
create policy "documents bucket owner read"   on storage.objects for select using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "documents bucket owner write"  on storage.objects for insert with check (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "documents bucket owner delete" on storage.objects for delete using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);
