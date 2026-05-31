'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Doc = {
  id: string
  title: string
  category: 'ca' | 'non_ca'
  status: 'processing' | 'ready' | 'failed'
  page_count: number | null
  byte_size: number | null
  error_message: string | null
  created_at: string
}

export function LibraryUI({
  role,
  initialDocs,
}: {
  role: 'ca' | 'lawyer'
  initialDocs: Doc[]
}) {
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[]>(initialDocs)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [category, setCategory] = useState<'ca' | 'non_ca'>(
    role === 'ca' ? 'ca' : 'non_ca',
  )

  // Poll for status while any doc is processing
  useEffect(() => {
    if (!docs.some(d => d.status === 'processing')) return
    const t = setInterval(async () => {
      const r = await fetch('/api/documents', { cache: 'no-store' })
      if (r.ok) {
        const data = (await r.json()) as { documents: Doc[] }
        setDocs(data.documents)
      }
    }, 2500)
    return () => clearInterval(t)
  }, [docs])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setErr(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('title', f.name)
      fd.append('category', role === 'ca' ? 'ca' : category)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const t = await res.text()
        setErr(t)
      } else {
        router.refresh()
        const r = await fetch('/api/documents', { cache: 'no-store' })
        if (r.ok) {
          const data = (await r.json()) as { documents: Doc[] }
          setDocs(data.documents)
        }
      }
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this document and all its chunks?')) return
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    if (res.ok) setDocs(d => d.filter(x => x.id !== id))
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-4 border-b border-zinc-200 bg-white flex items-center justify-between">
        <div>
          <h1 className="font-semibold">Library</h1>
          <p className="text-xs text-zinc-500">
            {role === 'ca'
              ? 'CA workspace — uploads are categorised as CA.'
              : 'Lawyer workspace — pick a category for each upload.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {role === 'lawyer' && (
            <select
              value={category}
              onChange={e => setCategory(e.target.value as 'ca' | 'non_ca')}
              className="input !w-auto !py-1.5"
            >
              <option value="non_ca">Law (non-CA)</option>
              <option value="ca">CA / Tax</option>
            </select>
          )}
          <label className={'btn-primary cursor-pointer ' + (uploading ? 'opacity-60' : '')}>
            {uploading ? 'Uploading…' : 'Upload PDF'}
            <input
              type="file"
              accept="application/pdf"
              hidden
              disabled={uploading}
              onChange={onFile}
            />
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {err && (
          <div className="mb-4 text-sm text-red-600 border border-red-200 bg-red-50 rounded p-3">
            {err}
          </div>
        )}

        {docs.length === 0 ? (
          <div className="text-center text-zinc-500 mt-16">
            <p>No documents yet.</p>
            <p className="text-sm mt-1">Upload your first PDF to start asking questions.</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto rounded border border-zinc-200 bg-white divide-y divide-zinc-200">
            {docs.map(d => (
              <div
                key={d.id}
                className="flex items-center justify-between px-4 py-3 gap-4"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{d.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span
                      className={
                        'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ' +
                        (d.category === 'ca'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-indigo-100 text-indigo-800')
                      }
                    >
                      {d.category === 'ca' ? 'CA' : 'Law'}
                    </span>
                    <StatusBadge status={d.status} />
                    {d.page_count != null && <span>{d.page_count} pages</span>}
                    {d.byte_size != null && <span>{Math.round(d.byte_size / 1024)} KB</span>}
                    <span>{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                  {d.status === 'failed' && d.error_message && (
                    <div className="text-xs text-red-600 mt-1">{d.error_message}</div>
                  )}
                </div>
                <button
                  onClick={() => onDelete(d.id)}
                  className="text-xs text-zinc-500 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: Doc['status'] }) {
  const cls =
    status === 'ready'
      ? 'bg-zinc-100 text-zinc-700'
      : status === 'processing'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-red-100 text-red-700'
  return (
    <span className={'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ' + cls}>
      {status}
    </span>
  )
}
