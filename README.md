# LexRAG

AI assistant for Indian Chartered Accountants and Lawyers.
RAG over a per-user document corpus, grounded in BNS / BNSS / BSA + IT & GST Acts.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- Supabase: Postgres + pgvector + Auth + Storage
- Google Gemini: `gemini-2.5-flash` (chat + PDF extraction), `gemini-embedding-001` (768-dim embeddings)

## Roles

- **CA** — sees only documents categorised as `ca`. All their uploads are forced to `ca`.
- **Lawyer** — sees both `ca` and `non_ca`. Picks category per upload.

Visibility is enforced by a SECURITY DEFINER Postgres RPC (`match_chunks`) that filters by `owner_id` and `user_role`.

## Local dev

```bash
cp .env.local.example .env.local   # then fill in values
npm install
node scripts/apply-migrations.mjs  # one-time: applies SQL to Supabase
npm run dev
```

## Env vars

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=          # only needed for migrations
GEMINI_API_KEY=
```

## Project map

```
app/
  page.tsx              landing
  login/                login
  signup/               signup with role select
  app/                  authed shell (sidebar + chat + library)
  api/
    upload/             POST: ingest a PDF (chunk + embed)
    documents/          GET list, DELETE one
    chat/               POST: embed query, retrieve, generate
lib/
  supabase/             server + browser clients, admin client
  gemini.ts             chat + embed wrappers
  pdf.ts                PDF text extraction via Gemini (handles scans)
  chunk.ts              section-aware legal-text chunker
supabase/migrations/    SQL schema + RLS + RPC
scripts/                migrate, smoke-test, create-test-user, make-test-pdfs
middleware.ts           redirects unauthenticated traffic to /login
```

## Status

v0 alpha. No paywall yet. PDF uploads only (URL scraping comes in v1).
