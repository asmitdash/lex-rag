// Deterministic answer-grounding check.
//
// For every number, date, and quoted phrase in the answer, check that it
// appears (or near-appears with edit distance ≤ 2) somewhere in the retrieved
// chunks. Sub-100ms — pure regex + string scan, no LLM.
//
// Inspired by D:\codezzz\Claude\corroborate\corroborate\corroborate.py.

export type Span = { text: string; kind: 'number' | 'date' | 'quote' }
export type Finding = {
  span: Span
  found: boolean
  best_match?: string
  edit_distance?: number
}
export type CorroborateReport = {
  spans: Span[]
  findings: Finding[]
  pass: boolean
  marginal: boolean // some failed but most passed
}

const NUMBER_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g
const DATE_RE =
  /\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi
const QUOTE_RE = /"([^"]{6,200})"|"([^"]{6,200})"/g

export function extractSpans(answer: string): Span[] {
  const spans: Span[] = []
  for (const m of answer.matchAll(NUMBER_RE)) spans.push({ text: m[0], kind: 'number' })
  for (const m of answer.matchAll(DATE_RE)) spans.push({ text: m[0], kind: 'date' })
  for (const m of answer.matchAll(QUOTE_RE))
    spans.push({ text: (m[1] ?? m[2]).trim(), kind: 'quote' })
  // De-dup
  const seen = new Set<string>()
  return spans.filter(s => {
    const key = `${s.kind}:${s.text.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function editDistance(a: string, b: string, maxAcceptable = 2): number {
  if (Math.abs(a.length - b.length) > maxAcceptable) return maxAcceptable + 1
  const dp = new Array(b.length + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1
    let cur = i
    let rowMin = cur
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      cur = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j - 1], dp[j]) + 1
      dp[j - 1] = prev
      prev = tmp
      if (cur < rowMin) rowMin = cur
    }
    dp[b.length] = cur
    if (rowMin > maxAcceptable) return maxAcceptable + 1
  }
  return dp[b.length]
}

function findApprox(needle: string, haystack: string): { match?: string; dist: number } {
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()
  if (h.includes(n)) return { match: needle, dist: 0 }
  // Slide a window of needle length and check edit distance for short needles
  if (n.length <= 12) return { dist: 99 }
  for (let i = 0; i <= h.length - n.length; i++) {
    const window = h.slice(i, i + n.length)
    const d = editDistance(n, window, 2)
    if (d <= 2) return { match: window, dist: d }
  }
  return { dist: 99 }
}

export function checkAnswer(answer: string, chunks: string[]): CorroborateReport {
  const spans = extractSpans(answer)
  const haystack = chunks.join('\n')
  const findings: Finding[] = spans.map(s => {
    const r = findApprox(s.text, haystack)
    if (r.match && r.dist <= 2) {
      return { span: s, found: true, best_match: r.match, edit_distance: r.dist }
    }
    return { span: s, found: false }
  })
  const total = findings.length
  const failures = findings.filter(f => !f.found).length
  const pass = total === 0 || failures === 0
  const marginal = failures > 0 && failures <= Math.max(1, Math.ceil(total * 0.34))
  return { spans, findings, pass, marginal }
}
