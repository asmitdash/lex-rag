// Simple in-memory rate limiter for the public /try-it endpoints.
//
// Trade-off: a Vercel function may be re-issued across instances, so this is
// best-effort per warm container. Good enough for the demo gate; swap for
// Upstash Redis when traffic warrants.

type Entry = { count: number; resetAt: number }
const buckets = new Map<string, Entry>()

export function checkLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const cur = buckets.get(key)
  if (!cur || cur.resetAt <= now) {
    const fresh: Entry = { count: 1, resetAt: now + windowMs }
    buckets.set(key, fresh)
    return { ok: true, remaining: limit - 1, resetAt: fresh.resetAt }
  }
  if (cur.count >= limit) {
    return { ok: false, remaining: 0, resetAt: cur.resetAt }
  }
  cur.count++
  return { ok: true, remaining: limit - cur.count, resetAt: cur.resetAt }
}

export function clientIp(req: Request): string {
  const h = req.headers
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    'anon'
  )
}
