/** Deterministic V2 state machines shared by traits and scenario tests. */
export type LogRecord = { offset: number; key: string; appendedAtMs: number; value?: unknown }

export class ReplicatedLog {
  private readonly partitions: LogRecord[][]
  private readonly offsets = new Map<string, number>()
  private readonly members = new Map<string, string[]>()

  constructor(
    private readonly partitionCount: number,
    private readonly retentionMs: number
  ) {
    this.partitions = Array.from({ length: Math.max(1, partitionCount) }, () => [])
  }

  append(key: string, nowMs: number, value?: unknown): { partition: number; offset: number } {
    const partition = hash(key) % this.partitions.length
    const records = this.partitions[partition]!
    const record = {
      offset: records.length === 0 ? 0 : records[records.length - 1]!.offset + 1,
      key,
      appendedAtMs: nowMs,
      value
    }
    records.push(record)
    return { partition, offset: record.offset }
  }

  rebalance(group: string, memberIds: readonly string[]): void {
    this.members.set(group, [...memberIds].sort())
  }

  poll(group: string, memberId: string, partition: number, nowMs: number): LogRecord | null {
    this.expire(nowMs)
    const members = this.members.get(group) ?? [memberId]
    if (members[partition % members.length] !== memberId) return null
    const offset = this.offsets.get(`${group}:${partition}`) ?? 0
    return this.partitions[partition]?.find((record) => record.offset >= offset) ?? null
  }

  commit(group: string, partition: number, offset: number): void {
    this.offsets.set(`${group}:${partition}`, offset + 1)
  }

  expire(nowMs: number): number {
    let expired = 0
    for (const records of this.partitions) {
      while (records[0] && nowMs - records[0].appendedAtMs >= this.retentionMs) {
        records.shift()
        expired++
      }
    }
    return expired
  }
}

export type ReplicaRole = 'leader' | 'follower' | 'failed'
export type ReplicaMember = { id: string; role: ReplicaRole; term: number; appliedIndex: number }

export class ReplicaCluster {
  private members: ReplicaMember[]
  constructor(initial: ReplicaMember[]) {
    this.members = initial.map((member) => ({ ...member }))
  }
  write(requiredAcks: number): { committed: boolean; index: number; acknowledgements: number } {
    const leader = this.members.find((member) => member.role === 'leader')
    const healthy = this.members.filter((member) => member.role !== 'failed')
    if (!leader || healthy.length < requiredAcks)
      return {
        committed: false,
        index: leader?.appliedIndex ?? 0,
        acknowledgements: healthy.length
      }
    const index = leader.appliedIndex + 1
    healthy.forEach((member) => {
      member.appliedIndex = index
    })
    return { committed: true, index, acknowledgements: healthy.length }
  }
  fail(memberId: string): void {
    const member = this.members.find((entry) => entry.id === memberId)
    if (member) member.role = 'failed'
  }
  elect(): ReplicaMember | null {
    const candidate = this.members
      .filter((member) => member.role !== 'failed')
      .sort((a, b) => b.appliedIndex - a.appliedIndex || a.id.localeCompare(b.id))[0]
    if (!candidate) return null
    const term = Math.max(...this.members.map((member) => member.term)) + 1
    this.members.forEach((member) => {
      if (member.role !== 'failed') member.role = member.id === candidate.id ? 'leader' : 'follower'
      member.term = term
    })
    return { ...candidate, role: 'leader', term }
  }
  snapshot(): ReplicaMember[] {
    return this.members.map((member) => ({ ...member }))
  }
}

export interface ExternalOutcomeProbe {
  lookup(key: string): 'committed' | 'not-found' | 'unknown'
}
export function reconcileExternalOutcome(
  probe: ExternalOutcomeProbe,
  key: string
): 'commit-confirmed' | 'safe-retry' | 'replay-blocked' {
  const result = probe.lookup(key)
  return result === 'committed'
    ? 'commit-confirmed'
    : result === 'not-found'
      ? 'safe-retry'
      : 'replay-blocked'
}

export type ProtocolSession = {
  protocol: 'tcp' | 'http' | 'http2' | 'websocket'
  open: boolean
  streamWindow: number
}
export function routeSession(
  session: ProtocolSession,
  layer: 'l4' | 'l7',
  request: { path?: string },
  allowedPaths: readonly string[] = []
): 'forwarded' | 'rejected' | 'flow-controlled' {
  if (!session.open) return 'rejected'
  if (session.protocol === 'websocket' && session.streamWindow <= 0) return 'flow-controlled'
  if (
    layer === 'l7' &&
    allowedPaths.length > 0 &&
    (!request.path || !allowedPaths.includes(request.path))
  )
    return 'rejected'
  return 'forwarded'
}

function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}
