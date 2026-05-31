import { extractPdfWithGemini } from './gemini'

export async function extractPdfText(buf: Buffer, mimeType = 'application/pdf'): Promise<string> {
  return extractPdfWithGemini(buf, mimeType)
}
