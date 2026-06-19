// Retriever interface + factory.
//
// Three modes:
//   'mine'  → CorpusRetriever (Postgres hybrid search + rerank, user's workspaces + public)
//   'web'   → WebRetriever    (Brave/DDG search + on-the-fly browse + chunk + embed)
//   'both'  → MetaRetriever   (run both in parallel, RRF-fuse)
//
// The factory is the single place that decides which path runs. The chat route
// and the agent loop both go through here so the contract is identical.

import { CorpusRetriever } from './corpus'
import { WebRetriever } from './web'
import { rrfFuse } from './fuse'

export type RetrievedChunk = {
  id?: string
  document_id?: string | null
  workspace_id?: string | null
  content: string
  section?: string | null
  tags?: string[]
  similarity?: number
  source_type: 'corpus' | 'web'
  url?: string | null
}

export type RetrieveOpts = {
  tags?: string[]
  queryEmbedding?: number[]
}

export interface Retriever {
  retrieve(query: string, k: number, opts?: RetrieveOpts): Promise<RetrievedChunk[]>
}

class MetaRetriever implements Retriever {
  constructor(private corpus: CorpusRetriever, private web: WebRetriever) {}
  async retrieve(query: string, k: number, opts?: RetrieveOpts): Promise<RetrievedChunk[]> {
    const [c, w] = await Promise.all([
      this.corpus.retrieve(query, k, opts).catch(() => [] as RetrievedChunk[]),
      this.web.retrieve(query, k, opts).catch(() => [] as RetrievedChunk[]),
    ])
    return rrfFuse([c, w], k)
  }
}

export function getRetriever(
  mode: 'mine' | 'web' | 'both',
  userId: string,
): Retriever {
  if (mode === 'mine') return new CorpusRetriever(userId)
  if (mode === 'web') return new WebRetriever()
  return new MetaRetriever(new CorpusRetriever(userId), new WebRetriever())
}
