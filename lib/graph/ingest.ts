// GraphRAG ingest: extract typed entities + relations from each chunk via
// Gemini Flash (cheap), upsert nodes/edges into Postgres.
//
// Design choices:
// - Gemini Flash for extraction (cost — Opus 4.7 is reserved for community
//   summaries and global synthesis where it actually moves the needle).
// - Strict JSON schema; on parse failure we drop that chunk's contribution
//   rather than fail the upload.
// - Per-chunk concurrency 4. A 200-chunk doc takes ~50 batches * ~3s each.

import { GoogleGenAI } from '@google/genai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { withGeminiKey } from '../key-pool'
import { MODELS, embedBatch } from '../gemini'

export type ExtractedEntity = { name: string; type: string; description?: string }
export type ExtractedEdge = {
  src: string
  src_type: string
  dst: string
  dst_type: string
  relation: string
}

export type GraphFragment = {
  source_chunk_id?: string
  entities: ExtractedEntity[]
  edges: ExtractedEdge[]
}

const PROMPT = `You are a structured information extractor. From the given passage, identify:

- ENTITIES: key concepts, people, organizations, statutes, places, products, events, dates that the passage talks about. Each has a short canonical name (lowercase if generic, TitleCase if a proper noun) and a type (one of: person, org, statute, place, product, event, concept, date, other).
- RELATIONS: directed relationships between extracted entities. Each has src, dst, and a short relation phrase (e.g. "amends", "owns", "located_in", "applies_to").

Return ONLY a single JSON object with this shape, no commentary:

{
  "entities": [{"name": "...", "type": "...", "description": "..."}],
  "edges":    [{"src": "...", "src_type": "...", "dst": "...", "dst_type": "...", "relation": "..."}]
}

Be conservative: only emit entities/edges that the passage explicitly supports. If nothing meaningful, return empty arrays.`

function safeParse(s: string): GraphFragment | null {
  try {
    const trimmed = s.trim()
    const jsonStart = trimmed.indexOf('{')
    const jsonEnd = trimmed.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null
    const obj = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Partial<GraphFragment>
    return {
      entities: Array.isArray(obj.entities) ? obj.entities : [],
      edges: Array.isArray(obj.edges) ? obj.edges : [],
    }
  } catch {
    return null
  }
}

async function extractOne(text: string): Promise<GraphFragment> {
  try {
    const out = await withGeminiKey('chat', async key => {
      const client = new GoogleGenAI({ apiKey: key })
      const res = await client.models.generateContent({
        model: MODELS.chat,
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\nPASSAGE:\n${text}` }] }],
        config: { temperature: 0 },
      })
      return res.text ?? ''
    })
    return safeParse(out) ?? { entities: [], edges: [] }
  } catch {
    return { entities: [], edges: [] }
  }
}

export async function extractGraph(
  chunks: { id: string; text: string }[],
): Promise<GraphFragment[]> {
  const out: GraphFragment[] = new Array(chunks.length)
  const concurrency = 4
  let i = 0
  async function worker() {
    while (i < chunks.length) {
      const idx = i++
      const c = chunks[idx]
      const frag = await extractOne(c.text)
      out[idx] = { ...frag, source_chunk_id: c.id }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

function toPgvector(v: number[]): string {
  return `[${v.join(',')}]`
}

function key(name: string, type: string): string {
  return `${type}:${name.toLowerCase()}`
}

export async function persistGraph(
  admin: SupabaseClient,
  workspaceId: string,
  fragments: GraphFragment[],
): Promise<void> {
  // Collect distinct entities across all fragments
  const entityMap = new Map<string, ExtractedEntity>()
  for (const f of fragments) {
    for (const e of f.entities) {
      if (!e.name || !e.type) continue
      const k = key(e.name, e.type)
      if (!entityMap.has(k)) entityMap.set(k, e)
    }
  }
  if (entityMap.size === 0) return

  const entityList = [...entityMap.values()]
  const embedTexts = entityList.map(e =>
    e.description ? `${e.name} (${e.type}): ${e.description}` : `${e.name} (${e.type})`,
  )
  let embeddings: number[][] = []
  try {
    embeddings = await embedBatch(embedTexts)
  } catch {
    embeddings = entityList.map(() => new Array(768).fill(0))
  }

  // Upsert entities
  const rows = entityList.map((e, idx) => ({
    workspace_id: workspaceId,
    name: e.name,
    type: e.type,
    description: e.description ?? null,
    embedding: toPgvector(embeddings[idx]),
  }))

  const { data: upserted, error: upErr } = await admin
    .from('entities')
    .upsert(rows, { onConflict: 'workspace_id,name,type' })
    .select('id, name, type')
  if (upErr) {
    console.warn('[graph] entity upsert failed:', upErr.message)
    return
  }

  // Build name+type → id map (reload misses too — upsert returns only inserted/updated)
  const idMap = new Map<string, string>()
  for (const r of upserted ?? []) idMap.set(key(r.name as string, r.type as string), r.id as string)
  // For any entity not returned (already-existing identical row), pull it
  const missing = entityList.filter(e => !idMap.has(key(e.name, e.type)))
  if (missing.length) {
    const { data } = await admin
      .from('entities')
      .select('id, name, type')
      .eq('workspace_id', workspaceId)
      .in('name', missing.map(m => m.name))
    for (const r of data ?? []) idMap.set(key(r.name as string, r.type as string), r.id as string)
  }

  // Insert edges
  const edgeRows: {
    workspace_id: string
    src: string
    dst: string
    relation: string
    source_chunk_id: string | null
  }[] = []
  for (const f of fragments) {
    for (const e of f.edges) {
      const sId = idMap.get(key(e.src, e.src_type))
      const dId = idMap.get(key(e.dst, e.dst_type))
      if (!sId || !dId) continue
      edgeRows.push({
        workspace_id: workspaceId,
        src: sId,
        dst: dId,
        relation: e.relation,
        source_chunk_id: f.source_chunk_id ?? null,
      })
    }
  }
  if (edgeRows.length) {
    const { error: eErr } = await admin.from('edges').insert(edgeRows)
    if (eErr) console.warn('[graph] edge insert failed:', eErr.message)
  }
}
