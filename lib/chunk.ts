// Naive but legal-text-aware chunker.
// Strategy: split on common section/chapter headers when present; otherwise
// fall back to sliding paragraph windows of ~1200 chars with ~150 char overlap.

const SECTION_RE =
  /^(?:\s*)(?:section|sec\.|chapter|chap\.|article|art\.|clause)\s+\d+[A-Z]?\b.*$/im

export type Chunk = { text: string; meta?: Record<string, unknown> }

export function chunkText(raw: string, fallbackSize = 1200, overlap = 150): Chunk[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return []

  const lines = text.split('\n')
  const sections: { header?: string; body: string[] }[] = []
  let current: { header?: string; body: string[] } = { body: [] }
  for (const line of lines) {
    if (SECTION_RE.test(line)) {
      if (current.body.length || current.header) sections.push(current)
      current = { header: line.trim(), body: [] }
    } else {
      current.body.push(line)
    }
  }
  if (current.body.length || current.header) sections.push(current)

  const usingSections = sections.some(s => s.header)
  const chunks: Chunk[] = []

  if (usingSections) {
    for (const sec of sections) {
      const blob = [sec.header, ...sec.body].filter(Boolean).join('\n').trim()
      if (!blob) continue
      // If a section is huge, split with sliding window but keep header in meta
      if (blob.length <= fallbackSize * 1.5) {
        chunks.push({ text: blob, meta: sec.header ? { section: sec.header } : undefined })
      } else {
        for (const sub of slidingWindow(blob, fallbackSize, overlap)) {
          chunks.push({ text: sub, meta: sec.header ? { section: sec.header } : undefined })
        }
      }
    }
  } else {
    for (const sub of slidingWindow(text, fallbackSize, overlap)) {
      chunks.push({ text: sub })
    }
  }
  return chunks.filter(c => c.text.trim().length > 30)
}

function slidingWindow(text: string, size: number, overlap: number): string[] {
  const out: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(text.length, start + size)
    out.push(text.slice(start, end))
    if (end === text.length) break
    start = end - overlap
    if (start < 0) start = 0
  }
  return out
}
