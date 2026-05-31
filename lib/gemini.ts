import { GoogleGenAI } from '@google/genai'
import { withGeminiKey } from './key-pool'

export const MODELS = {
  chat: 'gemini-2.5-flash',
  embed: 'gemini-embedding-001',
} as const

export const EMBED_DIM = 768

function clientFor(key: string) {
  return new GoogleGenAI({ apiKey: key })
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  const out: number[][] = []
  const concurrency = 4
  let i = 0
  async function worker() {
    while (i < texts.length) {
      const idx = i++
      const v = await withGeminiKey('embed', async key => {
        const res = await clientFor(key).models.embedContent({
          model: MODELS.embed,
          contents: texts[idx],
          config: {
            outputDimensionality: EMBED_DIM,
            taskType: 'RETRIEVAL_DOCUMENT',
          },
        })
        const vec = res.embeddings?.[0]?.values
        if (!vec) throw new Error('No embedding returned')
        return vec
      })
      out[idx] = v
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

export async function embedQuery(text: string): Promise<number[]> {
  return withGeminiKey('embed', async key => {
    const res = await clientFor(key).models.embedContent({
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
  })
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
  return withGeminiKey('chat', async key => {
    const res = await clientFor(key).models.generateContent({
      model: MODELS.chat,
      contents,
      config: { systemInstruction: systemPrompt, temperature: 0.2 },
    })
    return res.text ?? ''
  })
}

export async function extractPdfWithGemini(buf: Buffer, mimeType = 'application/pdf'): Promise<string> {
  const base64 = buf.toString('base64')
  return withGeminiKey('chat', async key => {
    const res = await clientFor(key).models.generateContent({
      model: MODELS.chat,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: base64, mimeType } },
            {
              text:
                'Extract the full text content of this PDF. Preserve section / chapter / article ' +
                'headings exactly as they appear (e.g. "Section 103", "Chapter II"). Output only ' +
                'the document text, no commentary, no markdown fences.',
            },
          ],
        },
      ],
      config: { temperature: 0 },
    })
    return res.text ?? ''
  })
}
