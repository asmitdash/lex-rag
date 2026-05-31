'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = getSupabaseBrowser()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setErr(error.message)
      return
    }
    router.replace('/app')
    router.refresh()
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input mt-1"
            />
          </label>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-zinc-900 text-white font-medium disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="text-sm text-zinc-600">
            New here?{' '}
            <Link href="/signup" className="underline">
              Create an account
            </Link>
          </div>
        </form>
      </div>
    </main>
  )
}
