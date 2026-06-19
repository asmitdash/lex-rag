// GraphRAG query router.
//
// `local`  → use the standard vector path (chunks + hybrid_search). The
//             handler pulls a few entity neighborhoods on the side as context.
// `global` → pull all entity_summaries and let Opus 4.7 synthesize over them.
// `hybrid` → run both, concatenate.

import { GoogleGenAI } from '@google/genai'
import { withGeminiKey } from '../key-pool'
import { MODELS } from '../gemini'
import { getSupabaseAdmin } from '../supabase/server'
import { claudeOneShot } from '../bedrock'

export type QueryMode = 'local' | 'global' | 'hybrid'

const ROUTER_PROMPT = `Classify a question for retrieval over a knowledge graph + document corpus:

- "local"  → the answer is found in a few specific passages (e.g. "What does Section 23 say about X?", "When was Y filed?")
- "global" → the answer requires synthesizing across the whole corpus (e.g. "What are the main themes?", "Summarize the key parties and their relationships.")
- "hybrid" → both — needs specific passages AND high-level synthesis

Return ONLY one of: local, global, hybrid.`

export async function routeQuery(question: string): Promise<QueryMode> {
  try {
    const out = await withGeminiKey('chat', async key => {
      const client = new GoogleGenAI({ apiKey: key })
      const res = await client.models.generateContent({
        model: MODELS.chat,
        contents: [
          { role: 'user', parts: [{ text: `${ROUTER_PROMPT}\n\nQuestion: ${question}` }] },
        ],
        config: { temperature: 0 },
      })
      return (res.text ?? '').toLowerCase()
    })
    if (out.includes('global')) return 'global'
    if (out.includes('hybrid')) return 'hybrid'
    return 'local'
  } catch {
    return 'local'
  }
}

export async function globalSynthesis(
  workspaceId: string,
  question: string,
): Promise<string> {
  const admin = getSupabaseAdmin()
  const { data: summaries } = await admin
    .from('entity_summaries')
    .select('community_id, summary, member_ids')
    .eq('workspace_id', workspaceId)
    .limit(40)
  const corpus = (summaries ?? [])
    .map((s, i) => `[community ${i + 1}, ${(s.member_ids as string[]).length} members]\n${s.summary}`)
    .join('\n\n---\n\n')
  if (!corpus) return '(no graph community summaries available — upload more documents to build one)'
  return claudeOneShot({
    system:
      'Synthesize a tight, evidence-based answer using the listed community summaries. ' +
      'Cite the community number inline like [community 2]. If the summaries are insufficient, say so plainly.',
    user: `QUESTION: ${question}\n\nCOMMUNITY SUMMARIES:\n${corpus}\n\nANSWER:`,
    max_tokens: 1024,
    temperature: 0,
  })
}
