// CorpusRetriever — Postgres hybrid search (BM25 + vector + RRF) → reranker.
//
// Calls the hybrid_search RPC defined in supabase/migrations/0004_generalize_corpus.sql.
// Pulls top-20, then runs the BGE cross-encoder over the text to reorder, and
// returns top-K. Falls back to vector-only via match_chunks if hybrid_search
// is missing (e.g. before the migration is applied).

import { getSupabaseAdmin } from '../supabase/server'
import { embedQuery } from '../gemini'
import { rerank } from './rerank'
import type { Retriever, RetrievedChunk, RetrieveOpts } from './index'

const HYBRID_POOL = 20

type HybridRow = {
  id: string
  document_id: string
  content: string
  section_meta: { section?: string; source_url?: string } | null
  tags: string[] | null
  workspace_id: string
  rrf_score: number | null
  vector_rank: number | null
  bm25_rank: number | null
}

type VectorRow = {
  id: string
  document_id: string
  content: string
  section_meta: { section?: string; source_url?: string } | null
  tags: string[] | null
  workspace_id: string
  similarity: number
}

function toPgvector(v: number[]): string {
  return `[${v.join(',')}]`
}

export class CorpusRetriever implements Retriever {
  constructor(private userId: string) {}

  async retrieve(query: string, k: number, opts: RetrieveOpts = {}): Promise<RetrievedChunk[]> {
    const queryVec = opts.queryEmbedding ?? (await embedQuery(query))
    const admin = getSupabaseAdmin()

    // ── Hybrid first ─────────────────────────────────────────────────────
    const { data: hybrid, error: hybridErr } = await admin.rpc('hybrid_search', {
      query_embedding: toPgvector(queryVec),
      query_text: query,
      match_count: HYBRID_POOL,
      user_id: this.userId,
      filter_tags: opts.tags && opts.tags.length ? opts.tags : null,
    })

    let pool: RetrievedChunk[]
    if (!hybridErr && hybrid) {
      pool = (hybrid as HybridRow[]).map(r => ({
        id: r.id,
        document_id: r.document_id,
        workspace_id: r.workspace_id,
        content: r.content,
        section: r.section_meta?.section ?? null,
        tags: r.tags ?? [],
        similarity: r.rrf_score ?? 0,
        source_type: 'corpus' as const,
        url: r.section_meta?.source_url ?? null,
      }))
    } else {
      // Fallback: vector-only via match_chunks
      const { data: vec, error: vecErr } = await admin.rpc('match_chunks', {
        query_embedding: toPgvector(queryVec),
        match_count: HYBRID_POOL,
        user_id: this.userId,
        filter_tags: opts.tags && opts.tags.length ? opts.tags : null,
      })
      if (vecErr) throw new Error(`corpus retrieval failed: ${vecErr.message}`)
      pool = (vec as VectorRow[]).map(r => ({
        id: r.id,
        document_id: r.document_id,
        workspace_id: r.workspace_id,
        content: r.content,
        section: r.section_meta?.section ?? null,
        tags: r.tags ?? [],
        similarity: r.similarity,
        source_type: 'corpus' as const,
        url: r.section_meta?.source_url ?? null,
      }))
    }

    if (pool.length === 0) return []

    // ── Cross-encoder rerank → top-K ──────────────────────────────────────
    const reranked = await rerank(query, pool.map(c => ({ id: c.id ?? '', text: c.content })))
    const order = new Map(reranked.map((r, i) => [r.id, i]))
    const sorted = pool.slice().sort((a, b) => {
      const ai = order.get(a.id ?? '') ?? 1e9
      const bi = order.get(b.id ?? '') ?? 1e9
      return ai - bi
    })
    return sorted.slice(0, k)
  }
}
