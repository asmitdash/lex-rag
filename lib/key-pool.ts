// In-memory Gemini API key pool with per-pool state (chat vs embed).
// Failover on 429/503 (quota / overload) -> cool down for 60s.
// Permanent kill on 401/403 (invalid / disabled).
// State is per-Vercel-instance and self-heals.

type PoolName = 'chat' | 'embed'
type KeyState = {
  key: string
  cooldownUntil: number // ms epoch; 0 = available
  dead: boolean
}

const COOLDOWN_MS = 60_000

function loadKeys(): string[] {
  const raw = process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? ''
  return raw
    .split(/[,\s]+/)
    .map(k => k.trim())
    .filter(Boolean)
}

const keys = loadKeys()

const pools: Record<PoolName, KeyState[]> = {
  chat: keys.map(k => ({ key: k, cooldownUntil: 0, dead: false })),
  embed: keys.map(k => ({ key: k, cooldownUntil: 0, dead: false })),
}

function getKeysAvailable(pool: PoolName): KeyState[] {
  const now = Date.now()
  return pools[pool].filter(s => !s.dead && s.cooldownUntil <= now)
}

export function poolStats(pool: PoolName) {
  const now = Date.now()
  const all = pools[pool]
  return {
    total: all.length,
    available: all.filter(s => !s.dead && s.cooldownUntil <= now).length,
    cooling: all.filter(s => !s.dead && s.cooldownUntil > now).length,
    dead: all.filter(s => s.dead).length,
  }
}

// Run an async operation with a key from `pool`. The fn receives the current key
// and must throw an Error with `.status` (HTTP code) when the API rejects.
// On 429/503 -> mark cooling, try next key.
// On 401/403 -> mark dead, try next key.
// Other errors -> rethrow (likely a bug, not a key problem).
export async function withGeminiKey<T>(
  pool: PoolName,
  fn: (key: string) => Promise<T>,
): Promise<T> {
  if (!pools[pool].length) {
    throw new Error('No Gemini API keys configured. Set GEMINI_API_KEYS env var.')
  }
  let lastErr: unknown = null
  // Try every available key once. We don't loop forever — if all fail, surface.
  while (true) {
    const candidates = getKeysAvailable(pool)
    if (!candidates.length) break
    const candidate = candidates[0]
    try {
      const result = await fn(candidate.key)
      return result
    } catch (e: unknown) {
      lastErr = e
      const status = extractStatus(e)
      if (status === 429 || status === 503) {
        candidate.cooldownUntil = Date.now() + COOLDOWN_MS
        continue
      }
      if (status === 401 || status === 403) {
        candidate.dead = true
        continue
      }
      // Unrecognised error — could be transient network, malformed request, etc.
      // Try next key (in case it's per-key), but don't expand cooldown set.
      candidate.cooldownUntil = Date.now() + 5_000
      continue
    }
  }
  const stats = poolStats(pool)
  const reason = lastErr instanceof Error ? lastErr.message : 'unknown'
  throw new Error(
    `All Gemini keys exhausted for ${pool} (total=${stats.total} cooling=${stats.cooling} dead=${stats.dead}). Last error: ${reason}`,
  )
}

function extractStatus(e: unknown): number | null {
  if (!e || typeof e !== 'object') return null
  // @google/genai surfaces HTTP errors with `.status` or in nested `error`
  const anyE = e as { status?: number; code?: number; response?: { status?: number }; message?: string }
  if (typeof anyE.status === 'number') return anyE.status
  if (typeof anyE.code === 'number' && anyE.code >= 400) return anyE.code
  if (anyE.response && typeof anyE.response.status === 'number') return anyE.response.status
  if (typeof anyE.message === 'string') {
    const m = anyE.message.match(/\b(401|403|429|503)\b/)
    if (m) return Number(m[1])
  }
  return null
}
