# Lex-Rag

The most advanced RAG system you can run, end-to-end on your own infra.

Pluggable retrieval over user-uploaded corpora, the live web, or both fused.
Architected to compete head-to-head with Google Deep Research, OpenAI Deep
Research, Microsoft GraphRAG, and Glean.

## What's in the box

- **Contextual retrieval** (Anthropic-style) — every chunk gets a 50-100 token
  doc-context preamble before embedding, stored alongside the chunk.
- **Hybrid search** — Postgres BM25 (`tsvector` + `ts_rank_cd`) + pgvector cosine,
  fused via Reciprocal Rank Fusion (k=60) inside a single SQL RPC.
- **Cross-encoder reranking** — `Xenova/bge-reranker-v2-m3` ONNX via
  `@xenova/transformers` on the Vercel Node runtime. Top-20 → rerank → top-K.
- **Agentic multi-hop loop** — AWS Bedrock `global.anthropic.claude-opus-4-7`
  as planner with native tool-use. Tools: `search_corpus`, `search_web` (Brave
  + DuckDuckGo fallback), `browse_url`, `expand_query`, `final_answer`.
- **GraphRAG** — entity + edge extraction at ingest (Gemini Flash for cost),
  Louvain community detection, Bedrock Opus 4.7 community summaries, query
  router (local / global / hybrid).
- **Self-RAG / CRAG critique** — sub-100ms deterministic check on
  numbers/dates/quotes via a TS port of `corroborate`, escalating to Bedrock
  Opus 4.7 judge on marginal answers.
- **Pluggable corpus** — user docs, live web, or both fused. Same retriever
  interface, three modes.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- Supabase: Postgres + pgvector + Auth + Storage
- AWS Bedrock: `global.anthropic.claude-opus-4-7` (planner, judge, GraphRAG synthesis)
- Google Gemini: `gemini-2.5-flash` (text extraction, contextual preambles, query expansion, entity extraction), `gemini-embedding-001` (768-dim embeddings)
- Brave Search API (free tier, primary) + DuckDuckGo HTML scrape (fallback)
- BGE-reranker-v2-m3 via `@xenova/transformers`
- Graphology + `graphology-communities-louvain` for community detection

## Use cases

A `/use-cases` page links out to verticals built on top of Lex-Rag:

- **Jolly** — Indian Chartered Accountant + Lawyer assistant with OCR for
  scanned books. Separate repo + Vercel deploy.
- **Bring your own corpus** (`/try-it`) — anonymous, rate-limited self-serve
  demo of the full advanced stack on any PDF.

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
SUPABASE_DB_URL=                 # for migrations only

GEMINI_API_KEYS=                 # comma-separated, embedding + cheap chat path

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
BEDROCK_MODEL_ID=global.anthropic.claude-opus-4-7

BRAVE_API_KEY=                   # optional; falls back to DDG scrape

# Optional surfaces
NEXT_PUBLIC_JOLLY_URL=https://jolly.example
LEXRAG_DISABLE_RERANK=            # set to 1 to skip reranker (dev fast-path)
```

## Project map

```
app/
  page.tsx              landing
  use-cases/            public marketing for verticals (Jolly + try-it)
  try-it/               public anonymous demo
  login/, signup/       auth
  app/                  authed shell (sidebar + chat + library)
  api/
    upload/             POST: ingest a PDF (chunk + contextual + embed + graph)
    documents/          GET list, DELETE one
    chat/               POST: simple/agent + corpus/web/both dispatch
    try-it/upload/      anonymous + rate-limited
    try-it/chat/        anonymous + rate-limited
lib/
  retrieval/
    index.ts            Retriever factory (mine | web | both)
    corpus.ts           hybrid_search → BGE rerank
    web.ts              Brave / DuckDuckGo + browse + on-the-fly chunk + embed
    contextual.ts       chunk-context preambles via Gemini Flash
    rerank.ts           BGE-reranker-v2-m3 ONNX via @xenova/transformers
    fuse.ts             Reciprocal Rank Fusion across retrievers
  agent/
    loop.ts             Bedrock Opus 4.7 multi-hop planner
    tools.ts            search_corpus / search_web / browse_url / expand_query / final_answer
    judge.ts            corroborate (deterministic) + Bedrock judge fallback
    corroborate.ts      number/date/quote span verifier (sub-100ms)
  graph/
    ingest.ts           entity + edge extraction at upload
    community.ts        Louvain + community summaries
    query.ts            local / global / hybrid query router
  bedrock.ts            shared Bedrock Messages-API client (tool-use enabled)
  ratelimit.ts          in-memory IP rate limit for /try-it
  gemini.ts, key-pool.ts  embed + chat + key rotation
  pdf.ts, chunk.ts      typed-PDF extraction + section-aware chunker
supabase/migrations/
  0001_init.sql                   profiles + documents + chunks + chats + messages + RLS
  0002_workspaces.sql             workspaces + members + canonical public corpus
  0003_fix_match_chunks.sql       qualify ambiguous columns
  0004_generalize_corpus.sql      drop role/category, add tags + corpus_kind, add fts + context_preamble, hybrid_search RPC
  0005_graph.sql                  entities + edges + entity_summaries + RLS
```

## Status

v0.2 — domain-neutral rebuild on top of the original lex-rag scaffolding. The
original CA/Lawyer + OCR product is now a separate repo (Jolly).
