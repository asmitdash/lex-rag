'use client'

import Link from 'next/link'
import { useState } from 'react'

type Citation = {
  document_title: string
  section?: string | null
  similarity: number
  source_type: 'corpus' | 'web'
  source_url?: string | null
  snippet: string
}

export default function TryItPage() {
  const [docId, setDocId] = useState<string | null>(null)
  const [docTitle, setDocTitle] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [citations, setCitations] = useState<Citation[]>([])
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState<string | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploadErr(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('title', f.name)
      const res = await fetch('/api/try-it/upload', { method: 'POST', body: fd })
      const data = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        setUploadErr(data.error ?? `HTTP ${res.status}`)
      } else {
        setDocId(data.id)
        setDocTitle(f.name)
      }
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function onAsk() {
    const q = question.trim()
    if (!q || !docId) return
    setAsking(true)
    setAskErr(null)
    setAnswer(null)
    setCitations([])
    try {
      const res = await fetch('/api/try-it/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: q, document_id: docId }),
      })
      const data = (await res.json()) as {
        answer?: string
        citations?: Citation[]
        error?: string
      }
      if (!res.ok) {
        setAskErr(data.error ?? `HTTP ${res.status}`)
      } else {
        setAnswer(data.answer ?? '')
        setCitations(data.citations ?? [])
      }
    } finally {
      setAsking(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white">
        <Link href="/" className="font-semibold text-lg tracking-tight">Lex-Rag</Link>
        <Link
          href="/use-cases"
          className="text-sm px-3 py-1.5 rounded-md hover:bg-zinc-100"
        >
          ← Use cases
        </Link>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto space-y-10">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Bring your own corpus
            </h1>
            <p className="mt-2 text-zinc-600 max-w-xl">
              Anonymous demo. Upload a PDF (≤4.4 MB), then ask. Rate-limited to
              10 queries / day per IP.
            </p>
          </div>

          <Step n={1} title="Upload a PDF">
            {!docId ? (
              <div>
                <label className="inline-flex items-center px-4 py-2 rounded-md bg-zinc-900 text-white text-sm font-medium cursor-pointer hover:bg-zinc-700">
                  <input
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={onFile}
                    disabled={uploading}
                  />
                  {uploading ? 'Uploading…' : 'Choose PDF'}
                </label>
                {uploadErr && (
                  <div className="mt-3 text-sm text-red-600">{uploadErr}</div>
                )}
              </div>
            ) : (
              <div className="text-sm text-zinc-700">
                ✓ Uploaded: <span className="font-medium">{docTitle}</span>
              </div>
            )}
          </Step>

          <Step n={2} title="Ask a question" disabled={!docId}>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              disabled={!docId || asking}
              rows={3}
              placeholder={docId ? 'Ask anything from your PDF…' : 'Upload first.'}
              className="input w-full"
            />
            <div className="mt-3">
              <button
                onClick={onAsk}
                disabled={!docId || asking || !question.trim()}
                className="btn-primary"
              >
                {asking ? 'Thinking…' : 'Ask'}
              </button>
            </div>
            {askErr && <div className="mt-3 text-sm text-red-600">{askErr}</div>}
          </Step>

          {answer && (
            <div className="rounded-lg border border-zinc-200 bg-white p-5">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Answer</div>
              <div className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{answer}</div>
              {citations.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Sources</div>
                  {citations.map((c, i) => (
                    <details
                      key={i}
                      className="rounded border border-zinc-200 bg-zinc-50 text-xs"
                    >
                      <summary className="cursor-pointer px-3 py-2 flex justify-between gap-3">
                        <span className="font-medium truncate">
                          [{i + 1}] {c.document_title}
                          {c.section ? ` · ${c.section}` : ''}
                        </span>
                        <span className="text-zinc-500">
                          {(c.similarity * 100).toFixed(0)}%
                        </span>
                      </summary>
                      <div className="px-3 pb-3 text-zinc-700 whitespace-pre-wrap">
                        {c.snippet}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function Step({
  n,
  title,
  disabled,
  children,
}: {
  n: number
  title: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-full bg-zinc-900 text-white inline-flex items-center justify-center text-xs font-semibold">
          {n}
        </span>
        <h2 className="font-medium">{title}</h2>
      </div>
      <div className="mt-3 ml-10">{children}</div>
    </div>
  )
}
