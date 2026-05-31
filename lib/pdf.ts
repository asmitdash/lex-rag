// Use Gemini to extract text from a PDF buffer.
// This handles both text-based and scanned PDFs (built-in OCR).

import { genai } from './gemini'

export async function extractPdfText(buf: Buffer, mimeType = 'application/pdf'): Promise<string> {
  const base64 = buf.toString('base64')
  const res = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
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
}
