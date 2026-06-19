// Community detection over a workspace's entity graph + cached summaries.
//
// Strategy: load (entity → entity) adjacency for the workspace, run Louvain
// (graphology-communities-louvain) to assign each node a community id at level
// 0. For each community, ask Bedrock Opus 4.7 for a 4-6 sentence summary of
// what members have in common, store in entity_summaries.
//
// Re-run lazily: only when the entity count grows ≥25% since last refresh.

import type { SupabaseClient } from '@supabase/supabase-js'
import { claudeOneShot } from '../bedrock'

type GraphologyMod = {
  default: new () => {
    addNode: (id: string) => void
    hasNode: (id: string) => boolean
    addUndirectedEdge: (a: string, b: string, attrs?: Record<string, unknown>) => void
    nodes: () => string[]
  }
  Graph?: new () => unknown
}

type LouvainModule = (graph: unknown) => Record<string, number>

let louvainPromise: Promise<LouvainModule | null> | null = null
async function getLouvain(): Promise<LouvainModule | null> {
  if (louvainPromise) return louvainPromise
  louvainPromise = (async () => {
    try {
      const mod = (await import('graphology-communities-louvain')) as unknown as
        | { default: LouvainModule }
        | LouvainModule
      return ((mod as { default?: LouvainModule }).default ?? (mod as LouvainModule))
    } catch {
      return null
    }
  })()
  return louvainPromise
}

export async function shouldRefresh(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const { count } = await admin
    .from('entities')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
  const cur = count ?? 0
  if (cur === 0) return false

  const { data } = await admin
    .from('entity_summaries')
    .select('member_ids')
    .eq('workspace_id', workspaceId)
  const last = (data ?? []).reduce((s, r) => s + ((r.member_ids as string[]) ?? []).length, 0)
  if (last === 0) return cur > 0
  return cur >= last * 1.25
}

export async function refreshCommunities(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<{ communities: number; entities: number } | null> {
  const louvain = await getLouvain()
  const { default: Graph } = (await import('graphology')) as unknown as GraphologyMod
  if (!louvain || !Graph) return null

  const [{ data: entities }, { data: edges }] = await Promise.all([
    admin
      .from('entities')
      .select('id, name, type, description')
      .eq('workspace_id', workspaceId),
    admin.from('edges').select('src, dst, relation').eq('workspace_id', workspaceId),
  ])
  const ents = entities ?? []
  if (ents.length === 0) return { communities: 0, entities: 0 }

  const g = new Graph()
  for (const e of ents) g.addNode(e.id as string)
  for (const ed of edges ?? []) {
    if (g.hasNode(ed.src as string) && g.hasNode(ed.dst as string)) {
      try {
        g.addUndirectedEdge(ed.src as string, ed.dst as string, { relation: ed.relation })
      } catch {
        // duplicate undirected edge — ignore
      }
    }
  }

  const assignment = louvain(g)
  const groups = new Map<string, string[]>()
  for (const [nodeId, communityId] of Object.entries(assignment)) {
    const k = String(communityId)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(nodeId)
  }

  const entById = new Map<string, { name: string; type: string; description: string | null }>()
  for (const e of ents)
    entById.set(e.id as string, {
      name: e.name as string,
      type: e.type as string,
      description: (e.description as string | null) ?? null,
    })

  // Wipe stale summaries for this workspace, then insert fresh ones
  await admin.from('entity_summaries').delete().eq('workspace_id', workspaceId)

  const inserts: {
    community_id: string
    workspace_id: string
    level: number
    summary: string
    member_ids: string[]
  }[] = []
  for (const [communityId, members] of groups) {
    if (members.length < 2) continue
    const sketch = members
      .map(id => entById.get(id))
      .filter(Boolean)
      .slice(0, 40)
      .map(e => `- ${e!.name} (${e!.type})${e!.description ? `: ${e!.description}` : ''}`)
      .join('\n')
    let summary = ''
    try {
      summary = await claudeOneShot({
        system:
          'You write tight 4-6 sentence summaries of clusters of related entities for a knowledge-graph index. ' +
          'Focus on what the members have in common and the relationships between them. No hedging, no preamble.',
        user: `Members of this community:\n${sketch}\n\nWrite the summary.`,
        max_tokens: 512,
        temperature: 0,
      })
    } catch (e) {
      summary = '(summary unavailable: ' + (e as Error).message + ')'
    }
    inserts.push({
      community_id: `${workspaceId}:${communityId}`,
      workspace_id: workspaceId,
      level: 0,
      summary,
      member_ids: members,
    })
  }
  if (inserts.length) {
    const { error } = await admin.from('entity_summaries').insert(inserts)
    if (error) console.warn('[graph] summary insert failed:', error.message)
  }
  return { communities: inserts.length, entities: ents.length }
}
