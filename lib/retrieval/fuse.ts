// Reciprocal Rank Fusion across multiple ranked lists.
//
// RRF score per item:  Σ over lists L  of  1 / (k + rank_in_L)
// Items not present in a list contribute 0 from that list.
// Standard k = 60.
//
// We dedupe by a key — for corpus chunks, the chunk id; for web chunks, the URL
// + a content hash so two scrapers of the same page collapse.

import type { RetrievedChunk } from './index'

function keyFor(c: RetrievedChunk): string {
  if (c.id) return `c:${c.id}`
  if (c.url) {
    const tail = c.content.slice(0, 64).replace(/\s+/g, ' ')
    return `w:${c.url}#${tail}`
  }
  return `t:${c.content.slice(0, 96).replace(/\s+/g, ' ')}`
}

export function rrfFuse(
  lists: RetrievedChunk[][],
  topK: number,
  k = 60,
): RetrievedChunk[] {
  const scores = new Map<string, number>()
  const items = new Map<string, RetrievedChunk>()

  for (const list of lists) {
    list.forEach((c, rank) => {
      const key = keyFor(c)
      if (!items.has(key)) items.set(key, c)
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + rank + 1))
    })
  }

  const ranked = [...items.entries()]
    .map(([key, c]) => ({ key, c, score: scores.get(key) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return ranked.map(r => ({ ...r.c, similarity: r.score }))
}
