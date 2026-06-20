-- /try-it self-serve demo uses a shared anonymous user + workspace. Seed
-- both up-front so the FK constraints (documents.owner_id → auth.users.id,
-- documents.workspace_id → workspaces.id, etc.) are satisfied without the
-- runtime needing service-role privileges over auth.users.
--
-- Idempotent: safe to re-apply.

-- 1. Anon auth.users row.
--    The instance_id is the standard Supabase singleton.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'anon@lex-rag.demo',
  '',
  now(),
  now(),
  now(),
  '{"provider":"anon","providers":["anon"]}'::jsonb,
  '{"role":"lawyer"}'::jsonb,
  false,
  true
)
on conflict (id) do nothing;

-- 2. Anon profile. Role is left null (legacy column, see migration 0004).
insert into public.profiles (id, email, role)
values ('00000000-0000-0000-0000-000000000002', 'anon@lex-rag.demo', 'lawyer')
on conflict (id) do nothing;

-- 3. Anon workspace.
insert into public.workspaces (id, kind, name, owner_id)
values (
  '00000000-0000-0000-0000-000000000002',
  'public',
  'Anonymous /try-it workspace',
  '00000000-0000-0000-0000-000000000002'
)
on conflict (id) do nothing;

-- 4. Membership.
insert into public.workspace_members (workspace_id, user_id, role)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  'owner'
)
on conflict (workspace_id, user_id) do nothing;
