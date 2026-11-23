import type { AnyNodeData } from '@renderer/types/ui'

export interface ReplicationGroupBox {
  leaderId: string
  memberIds: string[]
  followerCount: number
  x: number
  y: number
  width: number
  height: number
}

export interface GroupNodeLike {
  id: string
  data: unknown
  position: { x: number; y: number }
  positionAbsolute?: { x: number; y: number }
  width?: number | null
  height?: number | null
}

const PADDING = 36
const DEFAULT_W = 96
const DEFAULT_H = 96

function role(data: AnyNodeData | undefined): 'leader' | 'follower' | null {
  if (data?.sim?.replicationEnabled !== true) return null
  const value = data.sim.replicationRole ?? 'leader'
  if (value === 'leader' || value === 'primary') return 'leader'
  if (value === 'follower' || value === 'replica') return 'follower'
  return null
}

/** Bounding boxes of each replication group (leader plus the followers it names). */
export function findReplicationGroups(nodes: readonly GroupNodeLike[]): ReplicationGroupBox[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const groups: ReplicationGroupBox[] = []
  for (const node of nodes) {
    const data = node.data as AnyNodeData | undefined
    if (role(data) !== 'leader') continue
    const listed = String(data?.sim?.replicaMembers ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    const memberIds = [
      node.id,
      ...listed.filter(
        (id) => id !== node.id && role(byId.get(id)?.data as AnyNodeData | undefined) === 'follower'
      )
    ]
    if (memberIds.length < 2) continue
    const members = memberIds.map((id) => byId.get(id)!)
    const rects = members.map((member) => {
      const pos = member.positionAbsolute ?? member.position
      return {
        x: pos.x,
        y: pos.y,
        w: member.width ?? DEFAULT_W,
        h: member.height ?? DEFAULT_H
      }
    })
    const minX = Math.min(...rects.map((r) => r.x)) - PADDING
    const minY = Math.min(...rects.map((r) => r.y)) - PADDING
    const maxX = Math.max(...rects.map((r) => r.x + r.w)) + PADDING
    const maxY = Math.max(...rects.map((r) => r.y + r.h)) + PADDING
    groups.push({
      leaderId: node.id,
      memberIds,
      followerCount: memberIds.length - 1,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    })
  }
  return groups
}
