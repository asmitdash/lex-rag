import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const { GoogleGenAI } = await import('@google/genai')
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const r = await ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: 'Section 103 of BNS deals with murder.',
  config: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' },
})
console.log('embedding length:', r.embeddings?.[0]?.values?.length)

const g = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [{ role: 'user', parts: [{ text: 'Say hi in 5 words.' }] }],
  config: { temperature: 0.2 },
})
console.log('chat:', g.text)
