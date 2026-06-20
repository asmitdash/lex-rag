// Smoke the public anonymous /api/try-it/* endpoints end-to-end.
//
// 1. POST a small synthetic PDF to /api/try-it/upload (anon, rate-limited).
// 2. POST a question to /api/try-it/chat against that doc.
// 3. Assert answer + citations come back.
//
// Usage: node scripts/smoke-try-it.mjs https://lex-rag.vercel.app

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
const __dirname = dirname(fileURLToPath(import.meta.url))

const HOST = process.argv[2] ?? 'https://lex-rag.vercel.app'
console.log(`TRY-IT SMOKE: ${HOST}`)

let failed = 0
function step(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  · ${detail}` : ''}`)
  if (!ok) failed++
}

// Build a real, parseable PDF on the fly (minimal valid PDF with one text obj)
function makePdf(text) {
  // A valid 1-page PDF containing the given text (deliberately simple, not scanned)
  const lines = [
    '%PDF-1.4',
    '1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj',
    '2 0 obj <</Type/Pages/Count 1/Kids[3 0 R]>> endobj',
    `3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources <</Font <</F1 5 0 R>>>>>> endobj`,
  ]
  const stream = `BT /F1 12 Tf 50 720 Td (${text.replace(/[()\\]/g, m => '\\' + m)}) Tj ET`
  lines.push(`4 0 obj <</Length ${stream.length}>> stream\n${stream}\nendstream endobj`)
  lines.push(`5 0 obj <</Type/Font/Subtype/Type1/BaseFont/Helvetica>> endobj`)
  // xref + trailer
  let body = lines.join('\n') + '\n'
  const xrefOffset = body.length
  body += `xref\n0 6\n0000000000 65535 f \n`
  // Compute offsets — for simplicity ignore exact offsets, use approximate
  // (most PDF tools tolerate this in synthetic test PDFs; if Gemini extraction
  // fails, we'll see it in the assertions).
  for (let i = 0; i < 5; i++) body += '0000000010 00000 n \n'
  body += `trailer <</Size 6/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'utf8')
}

// Use a real fixture PDF if one exists, otherwise the synthetic one above
const passage =
  'The Great Wall of China is a series of fortifications built across northern China. ' +
  'The mango is the national fruit of India and is known as the king of fruits.'

const pdf = makePdf(passage)
console.log(`  Using ${pdf.length}-byte synthetic PDF`)

// 1. Upload
const fd = new FormData()
fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'smoke.pdf')
fd.append('title', 'Try-It Smoke Doc')

const up = await fetch(`${HOST}/api/try-it/upload`, { method: 'POST', body: fd })
const upBody = await up.text()
step(
  'POST /api/try-it/upload',
  up.status === 200,
  `HTTP ${up.status} ${upBody.slice(0, 200)}`,
)

let upParsed = null
try {
  upParsed = JSON.parse(upBody)
} catch {}
const docId = upParsed?.id
step('upload returned id', !!docId, docId ?? '?')

if (!docId) {
  console.log('\nFAILED — no doc id, abort')
  process.exit(1)
}

// 2. Chat
const chat = await fetch(`${HOST}/api/try-it/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'What is the national fruit of India?', document_id: docId }),
})
const chatBody = await chat.text()
step(
  'POST /api/try-it/chat',
  chat.status === 200,
  `HTTP ${chat.status} ${chatBody.slice(0, 200)}`,
)

let chatParsed = null
try {
  chatParsed = JSON.parse(chatBody)
} catch {}
if (chatParsed) {
  step(
    'answer present',
    typeof chatParsed.answer === 'string' && chatParsed.answer.length > 0,
    chatParsed.answer ? chatParsed.answer.slice(0, 100) : '(no answer)',
  )
  step(
    'citations present',
    Array.isArray(chatParsed.citations) && chatParsed.citations.length > 0,
    `${chatParsed.citations?.length ?? 0} citations`,
  )
  if (chatParsed.verdict) {
    step(
      'self-critique verdict',
      ['grounded', 'partial'].includes(chatParsed.verdict.result),
      `${chatParsed.verdict.stage}/${chatParsed.verdict.result}`,
    )
  }
}

console.log(failed ? `\nFAILED ${failed} step(s)` : '\nALL GREEN')
process.exit(failed)
