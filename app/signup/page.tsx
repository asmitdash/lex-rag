'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const supabase = getSupabaseBrowser()
  const [accountType, setAccountType] = useState<'personal' | 'company'>('personal')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          account_type: accountType,
          full_name: name,
          company_name: accountType === 'company' ? companyName : null,
        },
      },
    })
    setLoading(false)
    if (error) {
      setErr(error.message)
      return
    }
    const { data: sess } = await supabase.auth.getSession()
    if (sess.session) router.replace('/app')
    else setErr('Account created. Check your email to confirm, then log in.')
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-2 text-sm text-zinc-600">Free during alpha.</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          <div>
            <label className="text-sm font-medium">Account type</label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Card
                selected={accountType === 'personal'}
                onClick={() => setAccountType('personal')}
                title="Personal"
                body="One user. Your private library."
              />
              <Card
                selected={accountType === 'company'}
                onClick={() => setAccountType('company')}
                title="Company"
                body="Shared library. Login is shared with co-workers."
              />
            </div>
          </div>

          {accountType === 'company' && (
            <Field label="Company name">
              <input
                required
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="input"
                placeholder="Acme Research"
              />
            </Field>
          )}

          <Field label="Full name">
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="input"
              placeholder="Your name"
            />
          </Field>

          <Field label="Work email">
            <input
              required
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input"
              placeholder="you@company.com"
            />
          </Field>

          <Field label="Password">
            <input
              required
              type="password"
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </Field>

          {err && <div className="text-sm text-red-600">{err}</div>}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Creating account…' : 'Create account'}
          </button>

          <div className="text-sm text-zinc-600">
            Already have one?{' '}
            <Link href="/login" className="underline">Log in</Link>
          </div>
        </form>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Card({
  selected,
  onClick,
  title,
  body,
}: {
  selected: boolean
  onClick: () => void
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-left rounded-lg border p-3 transition-colors ' +
        (selected
          ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900'
          : 'border-zinc-200 hover:bg-zinc-50')
      }
    >
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-zinc-600 mt-1">{body}</div>
    </button>
  )
}
