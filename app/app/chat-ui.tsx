'use client'

import { useState, useRef, useEffect } from 'react'

type Citation = {
  document_id: string
  document_title: string
  section?: string | null
  category: 'ca' | 'non_ca'
  similarity: number
  snippet: string
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
}

export function ChatUI({ role, docCount }: { role: 'ca' | 'lawyer'; docCount: number }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, loading])

  async function send() {
    const q = input.trim()
    if (!q || loading) return
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: q }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: q,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        setMessages(m => [
          ...m,
          { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${err}` },
        ])
      } else {
        const data = (await res.json()) as { answer: string; citations: Citation[] }
        setMessages(m => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: data.answer,
            citations: data.citations,
          },
        ])
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setMessages(m => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${msg}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-6 py-3 border-b border-zinc-200 bg-white text-sm flex items-center justify-between">
        <div>
          <span className="font-medium">Chat</span>{' '}
          <span className="text-zinc-500">
            · {role === 'ca' ? 'CA workspace (CA docs only)' : 'Lawyer workspace (CA + Law)'}
          </span>
        </div>
        <div className="text-xs text-zinc-500">
          {docCount} document{docCount === 1 ? '' : 's'} indexed
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto text-center text-zinc-500 mt-12">
            <h2 className="text-lg font-medium text-zinc-700">Ask anything from your library.</h2>
            <p className="mt-2 text-sm">
              {docCount === 0
                ? 'Upload a PDF in the Library tab to get started.'
                : 'Try: "Summarise the key sections of BNS that replaced IPC 302" or "Draft a reply to a Section 143(2) notice."'}
            </p>
          </div>
        )}
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map(m => (
            <MessageBubble key={m.id} m={m} />
          ))}
          {loading && (
            <div className="text-sm text-zinc-500">Thinking…</div>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white px-6 py-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Ask a question…"
            rows={2}
            className="flex-1 input resize-none"
          />
          <button onClick={send} disabled={loading || !input.trim()} className="btn-primary">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ m }: { m: Message }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-zinc-900 text-white rounded-lg px-4 py-2 text-sm whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
      {m.citations && m.citations.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Sources</div>
          {m.citations.map((c, i) => (
            <details key={i} className="rounded border border-zinc-200 bg-white text-xs">
              <summary className="cursor-pointer px-3 py-2 flex justify-between gap-3">
                <span className="font-medium truncate">
                  [{i + 1}] {c.document_title}
                  {c.section ? ` · ${c.section}` : ''}
                </span>
                <span className="text-zinc-500 shrink-0">
                  {(c.similarity * 100).toFixed(0)}% · {c.category === 'ca' ? 'CA' : 'Law'}
                </span>
              </summary>
              <div className="px-3 pb-3 text-zinc-700 whitespace-pre-wrap">{c.snippet}</div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
