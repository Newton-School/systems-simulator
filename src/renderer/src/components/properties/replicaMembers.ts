export function parseReplicaMemberIds(value: unknown): string[] {
  if (typeof value !== 'string') return []

  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ]
}

export function serializeReplicaMemberIds(ids: readonly string[]): string | undefined {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  return unique.length > 0 ? unique.join(',') : undefined
}

export function toggleReplicaMember(
  currentIds: readonly string[],
  memberId: string,
  selected: boolean,
  requiredMemberId: string
): string[] {
  const next = new Set(currentIds)
  if (selected) next.add(memberId)
  else if (memberId !== requiredMemberId) next.delete(memberId)
  next.add(requiredMemberId)
  return [...next]
}

interface MembershipNode {
  id: string
  data: unknown
}

type SimLike = Record<string, unknown> | undefined

function simOf(node: MembershipNode): SimLike {
  return (node.data as { sim?: SimLike } | undefined)?.sim
}

export function isReplicationLeaderSim(sim: SimLike): boolean {
  const role = sim?.replicationRole ?? 'leader'
  return sim?.replicationEnabled === true && (role === 'leader' || role === 'primary')
}

/** The leader whose member list contains this follower, if any. */
export function findManagingLeader(
  nodes: readonly MembershipNode[],
  followerId: string
): MembershipNode | undefined {
  return nodes.find(
    (node) =>
      node.id !== followerId &&
      isReplicationLeaderSim(simOf(node)) &&
      parseReplicaMemberIds(simOf(node)?.replicaMembers).includes(followerId)
  )
}

/**
 * The leader's member list is the single source of truth: every selected
 * database receives the same list (leader first) and the follower role, and
 * databases removed from the list are detached. Returns per-node `sim` patches.
 */
export function planReplicaMembershipSync(
  nodes: readonly MembershipNode[],
  leaderId: string,
  memberIds: readonly string[]
): { nodeId: string; sim: Record<string, unknown> }[] {
  const ordered = [leaderId, ...memberIds.filter((id) => id !== leaderId)]
  const serialized = serializeReplicaMemberIds(ordered)
  const selected = new Set(ordered)
  const patches: { nodeId: string; sim: Record<string, unknown> }[] = []
  for (const node of nodes) {
    if (node.id === leaderId) continue
    const sim = { ...(simOf(node) ?? {}) }
    if (selected.has(node.id)) {
      patches.push({
        nodeId: node.id,
        sim: {
          ...sim,
          replicationEnabled: true,
          replicationRole:
            isReplicationLeaderSim(sim) && sim.replicationRole ? sim.replicationRole : 'follower',
          replicaMembers: serialized
        }
      })
    } else if (parseReplicaMemberIds(sim.replicaMembers).includes(leaderId)) {
      delete sim.replicaMembers
      patches.push({ nodeId: node.id, sim: { ...sim, replicationEnabled: false } })
    }
  }
  return patches
}
