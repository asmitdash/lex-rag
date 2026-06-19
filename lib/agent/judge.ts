// Self-RAG / CRAG self-critique gate.
//
// Two stages:
//   1. corroborate (deterministic, sub-100ms) — every number/date/quote in the
//      answer must appear in the retrieved chunks.
//   2. If marginal, escalate to Bedrock Opus 4.7 judge for a 'grounded' /
//      'partial' / 'ungrounded' verdict + missing claims.
//
// Verdict is informational on the response — the chat route returns it on the
// payload so the UI can flag low-confidence answers.

import { claudeOneShot } from '../bedrock'
import { checkAnswer, type CorroborateReport } from './corroborate'

export type Verdict = {
  stage: 'deterministic' | 'judge'
  result: 'grounded' | 'partial' | 'ungrounded'
  missing_claims?: string[]
  corroborate?: CorroborateReport
}

const JUDGE_PROMPT = `You are an evidence verifier. Determine whether an ANSWER is grounded in the supplied CONTEXT.

Return ONLY a single JSON object on one line:
  {"verdict":"grounded"|"partial"|"ungrounded","missing_claims":[...]}

- "grounded"   = every load-bearing claim in the answer is supported by the context
- "partial"    = most are supported but some non-trivial claim isn't
- "ungrounded" = the answer makes claims the context does not support

"missing_claims" lists the unsupported claims (empty array if grounded).`

export async function judgeAnswer(opts: {
  question: string
  answer: string
  chunks: string[]
}): Promise<Verdict> {
  const corr = checkAnswer(opts.answer, opts.chunks)
  if (corr.pass) {
    return { stage: 'deterministic', result: 'grounded', corroborate: corr }
  }
  if (!corr.marginal) {
    // Many failures — call ungrounded without spending Opus tokens
    return {
      stage: 'deterministic',
      result: 'ungrounded',
      missing_claims: corr.findings.filter(f => !f.found).map(f => f.span.text),
      corroborate: corr,
    }
  }
  // Marginal — let Opus judge
  try {
    const ctx = opts.chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n---\n\n')
    const out = await claudeOneShot({
      system: JUDGE_PROMPT,
      user: `QUESTION: ${opts.question}\n\nANSWER:\n${opts.answer}\n\nCONTEXT:\n${ctx}`,
      max_tokens: 512,
      temperature: 0,
    })
    const start = out.indexOf('{')
    const end = out.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(out.slice(start, end + 1)) as {
        verdict?: 'grounded' | 'partial' | 'ungrounded'
        missing_claims?: string[]
      }
      return {
        stage: 'judge',
        result: parsed.verdict ?? 'partial',
        missing_claims: parsed.missing_claims ?? [],
        corroborate: corr,
      }
    }
  } catch {
    // fall through
  }
  return {
    stage: 'deterministic',
    result: 'partial',
    missing_claims: corr.findings.filter(f => !f.found).map(f => f.span.text),
    corroborate: corr,
  }
}
