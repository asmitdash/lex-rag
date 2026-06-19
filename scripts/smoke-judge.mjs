// Smoke test the deterministic corroborate + Bedrock judge gate.
// Pure-TS port lives at lib/agent/corroborate.ts; this script re-implements
// the deterministic check inline for quick verification without TS tooling.

const answer =
  'The fine is exactly Rs 5,432 under "the relevant section", filed on 12-03-2024.'

const chunks = [
  'The penalty was assessed at Rs 5,432 in March 2024 by the regulator.',
  'Filed on 12-03-2024 with the Registrar.',
]

const answerHallucinated =
  'The penalty is Rs 9,876,543 under section 123A, filed on 01-01-1999.'

function extractSpans(s) {
  const out = []
  for (const m of s.matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g)) out.push({ kind: 'number', text: m[0] })
  for (const m of s.matchAll(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g)) out.push({ kind: 'date', text: m[0] })
  for (const m of s.matchAll(/"([^"]{6,200})"|"([^"]{6,200})"/g)) out.push({ kind: 'quote', text: (m[1] ?? m[2]).trim() })
  return out
}

function check(answer, chunks) {
  const spans = extractSpans(answer)
  const hay = chunks.join('\n').toLowerCase()
  const findings = spans.map(s => ({ s, found: hay.includes(s.text.toLowerCase()) }))
  return { spans, findings }
}

console.log('grounded answer:')
console.log(check(answer, chunks))
console.log('\nhallucinated answer:')
console.log(check(answerHallucinated, chunks))
