// WebRetriever — live-web search + on-the-fly browse + chunk + embed.
//
// Search: Brave Search API (free tier, 2k/month) is primary. On 429/no-key,
// fall back to a DuckDuckGo HTML scrape that doesn't need credentials.
// Browse: a single fetch + Readability-style extraction (simple regex strip;
// the agent loop has a heavier Playwright path via browse_url).
//
// We DON'T persist web chunks to Postgres in v0. They live for the request
// only. A 'web_cache' corpus_kind is reserved on the schema for a later phase.

import { embedQuery } from '../gemini'
import { chunkText } from '../chunk'
import type { Retriever, RetrievedChunk, RetrieveOpts } from './index'

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/'

type SearchHit = { title: string; url: string; snippet: string }

async function searchBrave(query: string, k: number): Promise<SearchHit[]> {
  const apiKey = process.env.BRAVE_API_KEY
  if (!apiKey) throw new Error('no brave key')
  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${k}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })
  if (!res.ok) throw new Error(`brave ${res.status}`)
  const data = (await res.json()) as {
    web?: { results?: { title: string; url: string; description: string }[] }
  }
  const results = data.web?.results ?? []
  return results.slice(0, k).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }))
}

async function searchDDG(query: string, k: number): Promise<SearchHit[]> {
  const url = `${DDG_ENDPOINT}?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    },
  })
  if (!res.ok) throw new Error(`ddg ${res.status}`)
  const html = await res.text()
  const hits: SearchHit[] = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && hits.length < k) {
    const rawUrl = m[1]
    let target = rawUrl
    try {
      const u = new URL(rawUrl, 'https://duckduckgo.com')
      const uddg = u.searchParams.get('uddg')
      if (uddg) target = decodeURIComponent(uddg)
    } catch {
      // keep raw
    }
    hits.push({
      title: m[2].replace(/<[^>]+>/g, '').trim(),
      url: target,
      snippet: m[3].replace(/<[^>]+>/g, '').trim(),
    })
  }
  return hits
}

export async function webSearch(query: string, k: number): Promise<SearchHit[]> {
  try {
    return await searchBrave(query, k)
  } catch {
    return searchDDG(query, k)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function browseUrl(target: string, maxChars = 12_000): Promise<string> {
  const res = await fetch(target, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 LexRagBot/1.0 (+https://lexrag.example)',
    },
  })
  if (!res.ok) throw new Error(`fetch ${target} ${res.status}`)
  const html = await res.text()
  const text = stripHtml(html)
  return text.slice(0, maxChars)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9)
}

export class WebRetriever implements Retriever {
  async retrieve(query: string, k: number, _opts: RetrieveOpts = {}): Promise<RetrievedChunk[]> {
    const hits = await webSearch(query, Math.min(8, k * 2))
    if (!hits.length) return []

    // Pull top-3 pages and chunk them. (Bandwidth budget; a heavier path lives in agent/tools.)
    const pages = await Promise.allSettled(
      hits.slice(0, 3).map(async h => {
        const text = await browseUrl(h.url)
        return { hit: h, text }
      }),
    )
    const ok = pages
      .filter((p): p is PromiseFulfilledResult<{ hit: SearchHit; text: string }> => p.status === 'fulfilled')
      .map(p => p.value)

    const candidates: RetrievedChunk[] = []
    for (const { hit, text } of ok) {
      const chunks = chunkText(text, 1000, 100)
      for (const c of chunks.slice(0, 5)) {
        candidates.push({
          content: c.text,
          section: null,
          tags: [],
          source_type: 'web',
          url: hit.url,
        })
      }
    }
    if (!candidates.length) {
      // fall back to snippet-only "chunks"
      return hits.slice(0, k).map(h => ({
        content: `${h.title}\n${h.snippet}`,
        section: null,
        tags: [],
        source_type: 'web' as const,
        url: h.url,
      }))
    }

    // Score by cosine vs the query embedding
    const qVec = await embedQuery(query)
    const { embedBatch } = await import('../gemini')
    const candVecs = await embedBatch(candidates.map(c => c.content))
    const scored = candidates
      .map((c, i) => ({ c, score: cosine(qVec, candVecs[i]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
    return scored.map(s => ({ ...s.c, similarity: s.score }))
  }
}
