import { GoogleGenAI } from '@google/genai'

const apiKey = process.env.GEMINI_API_KEY!
export const genai = new GoogleGenAI({ apiKey })

export const MODELS = {
  chat: 'gemini-2.5-flash',
  embed: 'gemini-embedding-001',
} as const

export const EMBED_DIM = 768

// Embed a batch of strings; returns 768-dim vectors.
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  // gemini-embedding-001 supports outputDimensionality + RETRIEVAL_DOCUMENT/QUERY task types
  const out: number[][] = []
  // SDK only allows one input per call for this model; do them in series with a small concurrency
  const concurrency = 4
  let i = 0
  async function worker() {
    while (i < texts.length) {
      const idx = i++
      const res = await genai.models.embedContent({
        model: MODELS.embed,
        contents: texts[idx],
        config: {
          outputDimensionality: EMBED_DIM,
          taskType: 'RETRIEVAL_DOCUMENT',
        },
      })
      const v = res.embeddings?.[0]?.values
      if (!v) throw new Error('No embedding returned')
      out[idx] = v
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

export async function embedQuery(text: string): Promise<number[]> {
  const res = await genai.models.embedContent({
    model: MODELS.embed,
    contents: text,
    config: {
      outputDimensionality: EMBED_DIM,
      taskType: 'RETRIEVAL_QUERY',
    },
  })
  const v = res.embeddings?.[0]?.values
  if (!v) throw new Error('No embedding returned')
  return v
}

export async function generateAnswer(opts: {
  systemPrompt: string
  history: { role: 'user' | 'model'; text: string }[]
  userMessage: string
  context: string
}): Promise<string> {
  const { systemPrompt, history, userMessage, context } = opts

  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    {
      role: 'user' as const,
      parts: [
        {
          text:
            (context ? `RETRIEVED CONTEXT:\n${context}\n\n` : '') +
            `USER QUESTION:\n${userMessage}`,
        },
      ],
    },
  ]

  const res = await genai.models.generateContent({
    model: MODELS.chat,
    contents,
    config: { systemInstruction: systemPrompt, temperature: 0.2 },
  })
  return res.text ?? ''
}
