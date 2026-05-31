'use client'

import { useEffect, useRef, useState } from 'react'
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
  workspace_id: string
  owner_id: string
  visibility: 'workspace' | 'public'
  mine: boolean
}

const MAX_BYTES = 4 * 1024 * 1024 + 400 * 1024 // ~4.4 MB

export function LibraryUI({
  role,
  initialDocs,
  accountType,
}: {
  role: 'ca' | 'lawyer'
  accountType: 'personal' | 'company'
  initialDocs: Doc[]
}) {
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[]>(initialDocs)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [category, setCategory] = useState<'ca' | 'non_ca'>(role === 'ca' ? 'ca' : 'non_ca')
  const [visibility, setVisibility] = useState<'workspace' | 'public'>('workspace')
  const [sourceUrl, setSourceUrl] = useState('')
  const [confirmedDisclaimer, setConfirmedDisclaimer] = useState(false)
  const [filterTab, setFilterTab] = useState<'workspace' | 'public'>('workspace')
  const fileInputRef = useRef<HTMLInputElement>(null)

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

    if (f.size > MAX_BYTES) {
      setErr(
        `File is ${(f.size / (1024 * 1024)).toFixed(1)} MB. Limit is 4.5 MB. Split the PDF or use a smaller version.`,
      )
      e.target.value = ''
      return
    }
    if (visibility === 'public' && !sourceUrl.trim()) {
      setErr('Public corpus uploads require an official source URL (indiacode, sci.gov.in, pib.gov.in, etc).')
      e.target.value = ''
      return
    }
    if (visibility === 'public' && !confirmedDisclaimer) {
      setErr('Please confirm the public corpus disclaimer first.')
      e.target.value = ''
      return
    }

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('title', f.name)
      fd.append('category', role === 'ca' ? 'ca' : category)
      fd.append('visibility', visibility)
      if (sourceUrl.trim()) fd.append('source_url', sourceUrl.trim())
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        let msg = ''
        try {
          const j = (await res.json()) as { error?: string }
          msg = j.error ?? `HTTP ${res.status}`
        } catch {
          msg = `HTTP ${res.status}`
        }
        setErr(msg)
      } else {
        router.refresh()
        const r = await fetch('/api/documents', { cache: 'no-store' })
        if (r.ok) {
          const data = (await r.json()) as { documents: Doc[] }
          setDocs(data.documents)
        }
        setSourceUrl('')
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

  const visibleDocs = docs.filter(d => d.visibility === filterTab)

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-4 border-b border-zinc-200 bg-white space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-semibold">Library</h1>
            <p className="text-xs text-zinc-500">
              {accountType === 'company'
                ? 'Company workspace — visible to everyone using this account.'
                : 'Personal workspace — only you see your private uploads.'}{' '}
              Public corpus is shared by everyone on LexRAG.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-zinc-700">Upload to:</span>
              <button
                type="button"
                onClick={() => setVisibility('workspace')}
                className={
                  'px-2.5 py-1 rounded text-xs border ' +
                  (visibility === 'workspace'
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-300 hover:bg-zinc-50')
                }
              >
                {accountType === 'company' ? 'Company library (private)' : 'My library (private)'}
              </button>
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={
                  'px-2.5 py-1 rounded text-xs border ' +
                  (visibility === 'public'
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-300 hover:bg-zinc-50')
                }
              >
                Public corpus (everyone)
              </button>

              {role === 'lawyer' && (
                <>
                  <span className="text-xs font-medium text-zinc-700 ml-3">Category:</span>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as 'ca' | 'non_ca')}
                    className="input !w-auto !py-1 !text-xs"
                  >
                    <option value="non_ca">Law (non-CA)</option>
                    <option value="ca">CA / Tax</option>
                  </select>
                </>
              )}
            </div>

            {visibility === 'public' && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs space-y-2">
                <p>
                  <strong>Public corpus disclaimer.</strong> Upload only documents from official
                  Indian government sources (indiacode.nic.in, sci.gov.in, pib.gov.in, cbdt /
                  cbic / rbi / mca, Gazette of India). Do not upload commentaries, paid databases
                  (Manupatra, SCC Online), or articles. You confirm you have the right to share this
                  publicly.
                </p>
                <input
                  type="text"
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                  placeholder="Source URL (e.g. https://indiacode.nic.in/...)"
                  className="input !text-xs"
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={confirmedDisclaimer}
                    onChange={e => setConfirmedDisclaimer(e.target.checked)}
                  />
                  <span>I confirm this is from an official Indian government source.</span>
                </label>
              </div>
            )}
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              hidden
              disabled={uploading}
              onChange={onFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={'btn-primary ' + (uploading ? 'opacity-60' : '')}
            >
              {uploading ? 'Uploading…' : 'Upload PDF'}
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 pt-4 flex gap-1 border-b border-zinc-200 bg-white">
        <Tab active={filterTab === 'workspace'} onClick={() => setFilterTab('workspace')}>
          {accountType === 'company' ? 'Company library' : 'My library'}
        </Tab>
        <Tab active={filterTab === 'public'} onClick={() => setFilterTab('public')}>
          Public corpus
        </Tab>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {err && (
          <div className="mb-4 text-sm text-red-600 border border-red-200 bg-red-50 rounded p-3">
            {err}
          </div>
        )}

        {visibleDocs.length === 0 ? (
          <div className="text-center text-zinc-500 mt-16">
            <p>{filterTab === 'public' ? 'Public corpus is still being seeded.' : 'No documents yet.'}</p>
            <p className="text-sm mt-1">
              {filterTab === 'workspace' ? 'Upload your first PDF to start asking questions.' : ''}
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto rounded border border-zinc-200 bg-white divide-y divide-zinc-200">
            {visibleDocs.map(d => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3 gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{d.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <Badge color={d.category === 'ca' ? 'emerald' : 'indigo'}>
                      {d.category === 'ca' ? 'CA' : 'Law'}
                    </Badge>
                    <Badge color={d.visibility === 'public' ? 'sky' : 'zinc'}>
                      {d.visibility === 'public' ? 'Public' : 'Private'}
                    </Badge>
                    <StatusBadge status={d.status} />
                    {d.page_count != null && <span>{d.page_count} pages</span>}
                    {d.byte_size != null && <span>{Math.round(d.byte_size / 1024)} KB</span>}
                    <span>{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                  {d.status === 'failed' && d.error_message && (
                    <div className="text-xs text-red-600 mt-1">{d.error_message}</div>
                  )}
                </div>
                {d.mine && (
                  <button
                    onClick={() => onDelete(d.id)}
                    className="text-xs text-zinc-500 hover:text-red-600"
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-sm px-3 py-2 -mb-px border-b-2 ' +
        (active
          ? 'border-zinc-900 text-zinc-900 font-medium'
          : 'border-transparent text-zinc-500 hover:text-zinc-800')
      }
    >
      {children}
    </button>
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
    <span className={'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ' + cls}>{status}</span>
  )
}

function Badge({ color, children }: { color: 'emerald' | 'indigo' | 'sky' | 'zinc'; children: React.ReactNode }) {
  const map = {
    emerald: 'bg-emerald-100 text-emerald-800',
    indigo: 'bg-indigo-100 text-indigo-800',
    sky: 'bg-sky-100 text-sky-800',
    zinc: 'bg-zinc-100 text-zinc-700',
  }
  return (
    <span className={'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ' + map[color]}>{children}</span>
  )
}
