// Contextual retrieval (Anthropic-style).
//
// For each chunk, generate a 50-100 token preamble that situates the chunk
// within the document. The embedded text becomes `${preamble}\n\n${chunkText}`.
//
// Cost: one Gemini Flash call per chunk, parallelized at concurrency 8 against
// the existing key pool. If Gemini fails for any reason, we fall back to an
// empty preamble — the chunk still embeds and retrieves.

import { GoogleGenAI } from '@google/genai'
import { withGeminiKey } from '../key-pool'
import { MODELS } from '../gemini'
import type { Chunk } from '../chunk'

export type ContextualChunk = Chunk & { preamble: string }

const MAX_DOC_CHARS = 30_000 // keep prompt budget reasonable for huge books

function buildPrompt(docTitle: string, fullText: string, chunkText: string): string {
  const doc = fullText.length > MAX_DOC_CHARS ? fullText.slice(0, MAX_DOC_CHARS) : fullText
  return [
    `<document title="${docTitle}">`,
    doc,
    `</document>`,
    '',
    'Here is the chunk we want to situate within the whole document:',
    '<chunk>',
    chunkText,
    '</chunk>',
    '',
    'Please give a short, succinct context (50-100 tokens) to situate this chunk',
    'within the overall document for the purposes of improving search retrieval',
    'of the chunk. Answer only with the succinct context and nothing else.',
  ].join('\n')
}

async function generateOne(
  docTitle: string,
  fullText: string,
  chunkText: string,
): Promise<string> {
  try {
    return await withGeminiKey('chat', async key => {
      const client = new GoogleGenAI({ apiKey: key })
      const res = await client.models.generateContent({
        model: MODELS.chat,
        contents: [{ role: 'user', parts: [{ text: buildPrompt(docTitle, fullText, chunkText) }] }],
        config: { temperature: 0 },
      })
      return (res.text ?? '').trim()
    })
  } catch {
    return ''
  }
}

export async function contextualizeChunks(
  docTitle: string,
  fullText: string,
  chunks: Chunk[],
): Promise<ContextualChunk[]> {
  const out: ContextualChunk[] = new Array(chunks.length)
  const concurrency = 8
  let i = 0
  async function worker() {
    while (i < chunks.length) {
      const idx = i++
      const c = chunks[idx]
      const preamble = await generateOne(docTitle, fullText, c.text)
      out[idx] = { ...c, preamble }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}
