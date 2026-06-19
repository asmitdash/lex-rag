// Cross-encoder reranking via BGE-reranker-v2-m3 (ONNX) through @xenova/transformers.
//
// The model loads lazily and is cached on the global object so a warm Lambda
// container reuses it. If loading or scoring fails (e.g. function size limit
// hit), we degrade gracefully: return the input order unchanged so the caller
// still gets a list.
//
// Environment escape hatch:
//   LEXRAG_DISABLE_RERANK=1   skip rerank entirely (dev fast-path)

type Pair = { id: string; text: string }
type Scored = { id: string; score: number }

const MODEL = 'Xenova/bge-reranker-v2-m3'

type TransformersModule = {
  pipeline: (
    task: string,
    model?: string,
  ) => Promise<(pairs: { text: string; text_pair: string }[]) => Promise<{ score: number }[]>>
  env?: { allowLocalModels?: boolean; useBrowserCache?: boolean }
}

type RerankFn = (pairs: { text: string; text_pair: string }[]) => Promise<{ score: number }[]>

let pipePromise: Promise<RerankFn | null> | null = null

async function getPipe(): Promise<RerankFn | null> {
  if (pipePromise) return pipePromise
  pipePromise = (async () => {
    try {
      const mod = (await import('@xenova/transformers')) as unknown as
        | TransformersModule
        | { default: TransformersModule }
      const t = (mod as { default?: TransformersModule }).default ?? (mod as TransformersModule)
      if (t.env) t.env.allowLocalModels = false
      const pipe = await t.pipeline('text-classification', MODEL)
      return pipe as RerankFn
    } catch (e) {
      console.warn('[rerank] could not load reranker, falling back to identity:', e)
      return null
    }
  })()
  return pipePromise
}

export async function rerank(query: string, candidates: Pair[]): Promise<Scored[]> {
  if (process.env.LEXRAG_DISABLE_RERANK === '1') {
    return candidates.map((c, i) => ({ id: c.id, score: candidates.length - i }))
  }
  if (!candidates.length) return []

  const pipe = await getPipe()
  if (!pipe) {
    return candidates.map((c, i) => ({ id: c.id, score: candidates.length - i }))
  }

  try {
    const pairs = candidates.map(c => ({ text: query, text_pair: c.text }))
    const scored = await pipe(pairs)
    return candidates
      .map((c, i) => ({ id: c.id, score: scored[i]?.score ?? 0 }))
      .sort((a, b) => b.score - a.score)
  } catch (e) {
    console.warn('[rerank] inference failed, falling back to identity:', e)
    return candidates.map((c, i) => ({ id: c.id, score: candidates.length - i }))
  }
}
