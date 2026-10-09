import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { Request } from '../core/events'
import type { ComponentNode, ComponentType } from '../core/types'
import { checkRegisterLinearizability, type RegisterOperation } from '../semantics/linearizability'
import {
  SERVICE_TIME_WAIT_APPLIED_MS_KEY,
  SERVICE_TIME_WAIT_UNTIL_US_KEY
} from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

/**
 * Read consistency on a replicated datastore, plus the oracles that check it.
 *
 * Data-version substrate: every write that a leader finishes serving commits a
 * new version of its key (`request.metadata.__key`). A follower applies that
 * version `replicationLagMs` later (the lag the replication capability already
 * configures; a quorum-acknowledged write is already on the followers when it
 * commits, because its service time waited for the acks). A read observes the
 * newest version its node has applied when its service finishes.
 *
 * The consistency model decides what a follower read must wait for before it
 * can answer (the real mechanism: MySQL WAIT_FOR_EXECUTED_GTID_SET, MongoDB
 * afterClusterTime, Raft ReadIndex on a follower):
 *  - eventual         - nothing; answer from whatever is applied.
 *  - monotonic-reads  - the newest version this session already read for the key.
 *  - read-your-writes - the newest version this session's acknowledged writes created.
 *  - strong           - the newest version committed on the leader when the read arrived.
 * Leader reads always see the newest committed version. The wait is added to the
 * read's service time (it holds the worker, like a blocked connection), so its
 * latency and capacity cost is measured, not declared.
 *
 * Oracles (always on for tracked nodes, whatever the model): stale reads,
 * read-your-writes violations, monotonic-read violations, and a bounded
 * single-key register linearizability check over the recorded history.
 */

export const CONSISTENCY_MODELS = [
  'eventual',
  'monotonic-reads',
  'read-your-writes',
  'strong'
] as const
export type ConsistencyModel = (typeof CONSISTENCY_MODELS)[number]

export const CONSISTENCY_COMPONENT_TYPES = [
  'relational-db',
  'nosql-db'
] as const satisfies readonly ComponentType[]

/** Recorded operations per key that the linearizability checker examines. */
export const CONSISTENCY_OPS_PER_KEY_BOUND = 100
/** Keys (first touched first) whose history is recorded and checked. */
export const CONSISTENCY_KEYS_BOUND = 200
/** Search budget per key; beyond it the key is reported as inconclusive. */
export const CONSISTENCY_CHECK_MAX_STEPS = 100_000

const LEDGER_STATE_KEY = 'consistency.ledger'
const OBSERVED_VERSION_KEY = '__consistencyObservedVersion'
const WRITTEN_VERSION_KEY = '__consistencyWrittenVersion'
const SESSION_FIELD = 'sessionId'

export function readConsistencyModel(
  config: Record<string, unknown> | undefined
): ConsistencyModel | null {
  const raw = config?.['consistencyModel']
  return typeof raw === 'string' && (CONSISTENCY_MODELS as readonly string[]).includes(raw)
    ? (raw as ConsistencyModel)
    : null
}

type Role = 'leader' | 'follower'

function roleOf(config: Record<string, unknown> | undefined): Role {
  const role = config?.['replicationRole']
  return role === 'replica' || role === 'follower' ? 'follower' : 'leader'
}

function lagUsOf(config: Record<string, unknown> | undefined): number {
  const raw = config?.['replicationLagMs']
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw * 1000 : 0
}

function writesWaitForQuorum(config: Record<string, unknown> | undefined): boolean {
  return config?.['replicationEnabled'] === true && config?.['writeAckPolicy'] === 'quorum'
}

/**
 * Which nodes hold the same data. An explicit replica-member list is one
 * replica set; without one, every tracked node of the same component type is
 * treated as one dataset (the usual single primary + read replicas canvas).
 */
export function consistencyGroupId(node: ComponentNode): string {
  const members = node.config?.['replicaMembers']
  if (typeof members === 'string' && members.trim()) {
    const ids = members
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .sort()
    return `members:${ids.join('|')}`
  }
  return `type:${node.type}`
}

function asKey(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : null
}

interface CommittedVersion {
  version: number
  commitAtUs: number
  /** Quorum-acknowledged: followers already hold it at commit. */
  onFollowersAtCommit: boolean
}

interface HistoryOp {
  kind: 'read' | 'write'
  startUs: number
  endUs: number
  value: number
  dropped: boolean
}

interface KeyState {
  groupId: string
  key: string
  commits: CommittedVersion[]
  /** Whether this key is inside CONSISTENCY_KEYS_BOUND (history recorded). */
  recorded: boolean
  ops: HistoryOp[]
  opsBeyondBound: number
}

interface SessionKeyState {
  /** Acknowledged writes by this session to this key: ack time and version. */
  writeAcks: Array<{ atUs: number; version: number }>
  /** Successful reads by this session of this key: response time and version. */
  readAcks: Array<{ atUs: number; version: number }>
}

interface PendingOp {
  keyState: KeyState
  op: HistoryOp | null
  kind: 'read' | 'write'
  version: number
  sessionKey: string | null
}

export interface ConsistencyNodeReport {
  nodeId: string
  nodeLabel: string
  model: ConsistencyModel
  role: Role
  replicationLagMs: number
  reads: number
  staleReads: number
  catchUpWaits: number
  catchUpWaitMs: number
}

export interface ConsistencyReport {
  reads: number
  writes: number
  leaderReads: number
  followerReads: number
  staleReads: number
  readYourWritesViolations: number
  monotonicReadViolations: number
  catchUpWaits: number
  /** Sum of the replication catch-up waits actually applied to reads, in ms. */
  catchUpWaitMs: number
  /** Oldest data a stale read returned: ms since the newest version it missed committed. */
  maxStalenessMs: number
  /** Requests that reached a tracked node without a `__key` (not tracked). */
  keylessRequests: number
  /** Reads without a `sessionId`: read-your-writes and monotonic-read checks could not apply. */
  sessionlessReads: number
  nodes: ConsistencyNodeReport[]
  linearizability: {
    opsPerKeyBound: number
    keysBound: number
    keysTracked: number
    keysChecked: number
    keysLinearizable: number
    keysViolating: number
    /** Keys whose search exceeded the step budget: not checked, not passed. */
    keysInconclusive: number
    opsChecked: number
    /** Operations outside the bound (keys beyond keysBound, ops beyond opsPerKeyBound). */
    opsNotChecked: number
    violatingKeys: string[]
    /** True only when every recorded op was checked and none violated. */
    verified: boolean
  }
}

function emptyNodeReport(node: ComponentNode, model: ConsistencyModel): ConsistencyNodeReport {
  return {
    nodeId: node.id,
    nodeLabel: node.label ?? node.id,
    model,
    role: roleOf(node.config),
    replicationLagMs: lagUsOf(node.config) / 1000,
    reads: 0,
    staleReads: 0,
    catchUpWaits: 0,
    catchUpWaitMs: 0
  }
}

export class ConsistencyLedger {
  private readonly keys = new Map<string, KeyState>()
  private readonly sessions = new Map<string, SessionKeyState>()
  private readonly pending = new Map<string, PendingOp>()
  private readonly nodes = new Map<string, ConsistencyNodeReport>()
  private recordedKeyCount = 0
  readonly totals = {
    reads: 0,
    writes: 0,
    leaderReads: 0,
    followerReads: 0,
    staleReads: 0,
    readYourWritesViolations: 0,
    monotonicReadViolations: 0,
    catchUpWaits: 0,
    catchUpWaitMs: 0,
    maxStalenessMs: 0,
    keylessRequests: 0,
    sessionlessReads: 0
  }

  nodeReport(node: ComponentNode, model: ConsistencyModel): ConsistencyNodeReport {
    let report = this.nodes.get(node.id)
    if (!report) {
      report = emptyNodeReport(node, model)
      this.nodes.set(node.id, report)
    }
    return report
  }

  keyState(groupId: string, key: string): KeyState {
    const id = `${groupId}\u0000${key}`
    let state = this.keys.get(id)
    if (!state) {
      const recorded = this.recordedKeyCount < CONSISTENCY_KEYS_BOUND
      if (recorded) this.recordedKeyCount += 1
      state = { groupId, key, commits: [], recorded, ops: [], opsBeyondBound: 0 }
      this.keys.set(id, state)
    }
    return state
  }

  sessionKeyState(groupId: string, session: string, key: string): SessionKeyState {
    const id = sessionKeyId(groupId, session, key)
    let state = this.sessions.get(id)
    if (!state) {
      state = { writeAcks: [], readAcks: [] }
      this.sessions.set(id, state)
    }
    return state
  }

  peekSession(sessionKey: string): SessionKeyState | undefined {
    return this.sessions.get(sessionKey)
  }

  record(keyState: KeyState, op: HistoryOp): HistoryOp | null {
    if (!keyState.recorded) {
      keyState.opsBeyondBound += 1
      return null
    }
    if (keyState.ops.length >= CONSISTENCY_OPS_PER_KEY_BOUND) {
      keyState.opsBeyondBound += 1
      return null
    }
    keyState.ops.push(op)
    return op
  }

  setPending(id: string, pending: PendingOp): void {
    const previous = this.pending.get(id)
    // A retry re-entered the node before the earlier attempt resolved: the
    // earlier read returned nothing; the earlier write committed with an
    // outcome its client never learned (it stays open-ended).
    if (previous?.kind === 'read' && previous.op) previous.op.dropped = true
    this.pending.set(id, pending)
  }

  takePending(id: string): PendingOp | undefined {
    const pending = this.pending.get(id)
    if (pending) this.pending.delete(id)
    return pending
  }

  buildReport(): ConsistencyReport {
    // Reads still in flight at the cutoff never returned: not part of the history.
    for (const pending of this.pending.values()) {
      if (pending.kind === 'read' && pending.op) pending.op.dropped = true
    }

    let keysChecked = 0
    let keysLinearizable = 0
    let keysViolating = 0
    let keysInconclusive = 0
    let opsChecked = 0
    let opsNotChecked = 0
    const violatingKeys: string[] = []
    for (const state of this.keys.values()) {
      opsNotChecked += state.opsBeyondBound
      if (!state.recorded) continue
      const ops: RegisterOperation[] = state.ops
        .filter((op) => !op.dropped)
        .map((op) => ({ kind: op.kind, start: op.startUs, end: op.endUs, value: op.value }))
      if (ops.length === 0) continue
      keysChecked += 1
      const check = checkRegisterLinearizability(ops, 0, CONSISTENCY_CHECK_MAX_STEPS)
      if (check.result === 'inconclusive') {
        keysInconclusive += 1
        opsNotChecked += ops.length
        continue
      }
      opsChecked += ops.length
      if (check.result === 'linearizable') {
        keysLinearizable += 1
      } else {
        keysViolating += 1
        if (violatingKeys.length < 10) violatingKeys.push(state.key)
      }
    }

    return {
      ...this.totals,
      nodes: [...this.nodes.values()].map((node) => ({ ...node })),
      linearizability: {
        opsPerKeyBound: CONSISTENCY_OPS_PER_KEY_BOUND,
        keysBound: CONSISTENCY_KEYS_BOUND,
        keysTracked: this.keys.size,
        keysChecked,
        keysLinearizable,
        keysViolating,
        keysInconclusive,
        opsChecked,
        opsNotChecked,
        violatingKeys,
        verified:
          keysChecked > 0 && keysViolating === 0 && keysInconclusive === 0 && opsNotChecked === 0
      }
    }
  }
}

function sessionKeyId(groupId: string, session: string, key: string): string {
  return `${groupId}\u0000${session}\u0000${key}`
}

function ledger(sharedState: TraitStateStore | undefined): ConsistencyLedger | null {
  if (!sharedState) return null
  const existing = sharedState.get<ConsistencyLedger>(LEDGER_STATE_KEY)
  if (existing) return existing
  const created = new ConsistencyLedger()
  sharedState.set(LEDGER_STATE_KEY, created)
  return created
}

/** The run's consistency report, or undefined when no node tracked consistency. */
export function buildConsistencyReport(
  sharedState: TraitStateStore | undefined
): ConsistencyReport | undefined {
  return sharedState?.get<ConsistencyLedger>(LEDGER_STATE_KEY)?.buildReport()
}

function latestCommitted(state: KeyState, atUs: number): CommittedVersion | null {
  const commits = state.commits
  let lo = 0
  let hi = commits.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (commits[mid].commitAtUs <= atUs) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found >= 0 ? commits[found] : null
}

function applyAtUs(commit: CommittedVersion, lagUs: number): number {
  return commit.onFollowersAtCommit ? commit.commitAtUs : commit.commitAtUs + lagUs
}

/** Newest version a follower with `lagUs` has applied at `atUs` (0 = initial). */
function appliedOnFollower(state: KeyState, atUs: number, lagUs: number): number {
  for (let i = state.commits.length - 1; i >= 0; i -= 1) {
    if (applyAtUs(state.commits[i], lagUs) <= atUs) return state.commits[i].version
  }
  return 0
}

function commitOf(state: KeyState, version: number): CommittedVersion | null {
  // Versions are 1-based and appended in order.
  return version >= 1 && version <= state.commits.length ? state.commits[version - 1] : null
}

/** Newest version among acks that happened strictly before `beforeUs`. */
function floorBefore(acks: Array<{ atUs: number; version: number }>, beforeUs: number): number {
  let floor = 0
  for (const ack of acks) {
    if (ack.atUs < beforeUs && ack.version > floor) floor = ack.version
  }
  return floor
}

/** Read or write, case-insensitively (`READ` and `read` are the same operation). */
function operationOf(request: Request): 'read' | 'write' | null {
  const normalized = request.type.trim().toLowerCase()
  return normalized === 'read' || normalized === 'write' ? normalized : null
}

function sessionOf(request: Request): string | null {
  return asKey(request.metadata[SESSION_FIELD])
}

function newestAtArrivalKey(node: ComponentNode): string {
  return `__consistencyNewestAtArrival:${node.id}`
}

function pendingId(request: Request, node: ComponentNode): string {
  return `${request.id}@${node.id}`
}

function arrivalUsAt(request: Request, nodeId: string, fallbackUs: number): number {
  for (let i = request.spans.length - 1; i >= 0; i -= 1) {
    if (request.spans[i].nodeId === nodeId) return Number(request.spans[i].arrivalTime)
  }
  return fallbackUs
}

export const consistencyModelTrait: NodeBehaviourTrait = {
  name: 'storage.consistency-model',
  isEnabledFor: (node) => readConsistencyModel(node.config) !== null,
  beforeArrival: ({ node, request, clock, sharedState }) => {
    const model = readConsistencyModel(node.config)
    if (!model || operationOf(request) !== 'read') return { action: 'continue' }
    const key = asKey(request.metadata.__key)
    const book = ledger(sharedState)
    if (!key || !book) return { action: 'continue' }

    const groupId = consistencyGroupId(node)
    const state = book.keyState(groupId, key)
    const nowUs = Number(clock)
    // The staleness baseline: what the leader had committed when this read
    // arrived (captured now, so a write committing in the same instant but
    // processed after this arrival is concurrent, not missed).
    const newestAtArrival = latestCommitted(state, nowUs)?.version ?? 0
    request.metadata[newestAtArrivalKey(node)] = newestAtArrival
    if (roleOf(node.config) !== 'follower' || model === 'eventual') {
      return { action: 'continue' }
    }

    let required = 0
    if (model === 'strong') {
      required = newestAtArrival
    } else {
      const session = sessionOf(request)
      const sessionState = session
        ? book.peekSession(sessionKeyId(groupId, session, key))
        : undefined
      if (sessionState) {
        const createdUs = Number(request.createdAt)
        required =
          model === 'read-your-writes'
            ? floorBefore(sessionState.writeAcks, createdUs)
            : floorBefore(sessionState.readAcks, createdUs)
      }
    }
    const commit = commitOf(state, required)
    if (!commit) return { action: 'continue' }
    const readyAtUs = applyAtUs(commit, lagUsOf(node.config))
    if (readyAtUs <= nowUs) return { action: 'continue' }

    request.metadata[SERVICE_TIME_WAIT_UNTIL_US_KEY] = readyAtUs
    const report = book.nodeReport(node, model)
    report.catchUpWaits += 1
    book.totals.catchUpWaits += 1
    return {
      action: 'continue',
      payload: {
        consistencyModel: model,
        consistencyRequiredVersion: required,
        metricCounters: { consistencyCatchUpWaits: 1 }
      }
    }
  },
  beforeRouting: ({ node, request, clock, sharedState }) => {
    const model = readConsistencyModel(node.config)
    const book = ledger(sharedState)
    const operation = operationOf(request)
    if (!model || !book || !operation) {
      return { action: 'route' }
    }
    const appliedWaitMs = request.metadata[SERVICE_TIME_WAIT_APPLIED_MS_KEY]
    delete request.metadata[SERVICE_TIME_WAIT_UNTIL_US_KEY]
    delete request.metadata[SERVICE_TIME_WAIT_APPLIED_MS_KEY]
    const report = book.nodeReport(node, model)
    if (typeof appliedWaitMs === 'number' && appliedWaitMs > 0) {
      report.catchUpWaitMs += appliedWaitMs
      book.totals.catchUpWaitMs += appliedWaitMs
    }

    const key = asKey(request.metadata.__key)
    if (!key) {
      book.totals.keylessRequests += 1
      return { action: 'route', payload: { metricCounters: { consistencyKeyless: 1 } } }
    }

    const groupId = consistencyGroupId(node)
    const state = book.keyState(groupId, key)
    const nowUs = Number(clock)
    const role = roleOf(node.config)
    const session = sessionOf(request)
    const sessionKey = session ? sessionKeyId(groupId, session, key) : null

    if (operation === 'write') {
      if (role !== 'leader') return { action: 'route' }
      const version = state.commits.length + 1
      state.commits.push({
        version,
        commitAtUs: nowUs,
        onFollowersAtCommit: writesWaitForQuorum(node.config)
      })
      const op = book.record(state, {
        kind: 'write',
        startUs: Number(request.createdAt),
        endUs: Infinity,
        value: version,
        dropped: false
      })
      book.setPending(pendingId(request, node), {
        keyState: state,
        op,
        kind: 'write',
        version,
        sessionKey
      })
      request.metadata[WRITTEN_VERSION_KEY] = version
      book.totals.writes += 1
      return {
        action: 'route',
        payload: {
          consistencyWrite: version,
          metricCounters: { consistencyWrites: 1 }
        }
      }
    }

    // Read: observe the newest version this node has applied.
    const observed =
      role === 'leader'
        ? (latestCommitted(state, nowUs)?.version ?? 0)
        : appliedOnFollower(state, nowUs, lagUsOf(node.config))
    const stamped = request.metadata[newestAtArrivalKey(node)]
    delete request.metadata[newestAtArrivalKey(node)]
    const newestAtArrival =
      typeof stamped === 'number'
        ? stamped
        : (latestCommitted(state, arrivalUsAt(request, node.id, nowUs))?.version ?? 0)
    const stale = observed < newestAtArrival
    const counters: Record<string, number> = {
      consistencyReads: 1,
      [role === 'leader' ? 'consistencyLeaderReads' : 'consistencyFollowerReads']: 1
    }
    book.totals.reads += 1
    report.reads += 1
    if (role === 'leader') book.totals.leaderReads += 1
    else book.totals.followerReads += 1
    if (stale) {
      counters.consistencyStaleReads = 1
      book.totals.staleReads += 1
      report.staleReads += 1
      const firstMissed = commitOf(state, observed + 1)
      if (firstMissed) {
        const ageMs = (nowUs - firstMissed.commitAtUs) / 1000
        if (ageMs > book.totals.maxStalenessMs) book.totals.maxStalenessMs = ageMs
      }
    }

    let rywViolation = false
    let monotonicViolation = false
    if (!sessionKey) {
      book.totals.sessionlessReads += 1
      counters.consistencySessionlessReads = 1
    } else {
      const sessionState = book.peekSession(sessionKey)
      if (sessionState) {
        const createdUs = Number(request.createdAt)
        rywViolation = observed < floorBefore(sessionState.writeAcks, createdUs)
        monotonicViolation = observed < floorBefore(sessionState.readAcks, createdUs)
      }
      if (rywViolation) {
        counters.consistencyReadYourWritesViolations = 1
        book.totals.readYourWritesViolations += 1
      }
      if (monotonicViolation) {
        counters.consistencyMonotonicReadViolations = 1
        book.totals.monotonicReadViolations += 1
      }
    }

    const op = book.record(state, {
      kind: 'read',
      startUs: Number(request.createdAt),
      endUs: Infinity,
      value: observed,
      dropped: false
    })
    book.setPending(pendingId(request, node), {
      keyState: state,
      op,
      kind: 'read',
      version: observed,
      sessionKey
    })
    request.metadata[OBSERVED_VERSION_KEY] = observed
    return {
      action: 'route',
      payload: {
        consistencyModel: model,
        consistencyObservedVersion: observed,
        consistencyNewestVersion: newestAtArrival,
        ...(stale ? { consistencyStaleRead: true } : {}),
        metricCounters: counters
      }
    }
  },
  afterTerminal: ({ node, request, clock, sharedState, status }) => {
    const book = sharedState?.get<ConsistencyLedger>(LEDGER_STATE_KEY)
    const pending = book?.takePending(pendingId(request, node))
    if (!book || !pending) return
    const nowUs = Number(clock)
    if (status !== 'success') {
      // A failed read returned nothing; a committed write whose response failed
      // keeps an open-ended interval (its client never learned the outcome).
      if (pending.kind === 'read' && pending.op) pending.op.dropped = true
      return
    }
    if (pending.op) pending.op.endUs = nowUs
    if (pending.sessionKey) {
      const [groupId, session, key] = pending.sessionKey.split('\u0000')
      const sessionState = book.sessionKeyState(groupId, session, key)
      ;(pending.kind === 'write' ? sessionState.writeAcks : sessionState.readAcks).push({
        atUs: nowUs,
        version: pending.version
      })
    }
  }
}

function isReplicatedDatastore(data: CanvasNodeDataV2): boolean {
  return data.sim?.replicationEnabled === true
}

function isFollower(data: CanvasNodeDataV2): boolean {
  return data.sim?.replicationRole === 'follower' || data.sim?.replicationRole === 'replica'
}

export const consistencyModelCapabilityModule: NodeCapabilityModule = {
  name: 'storage.consistency-model',
  appliesTo: CONSISTENCY_COMPONENT_TYPES,
  hooks: consistencyModelTrait,
  config: {
    sections: [
      {
        id: 'consistency',
        title: 'Read Consistency',
        note: (data) => {
          if (!isReplicatedDatastore(data)) return null
          if (!data.sim?.consistencyModel || data.sim.consistencyModel === 'off') {
            return 'Off: reads are not version-tracked. Pick a model on the leader and on every follower to track data versions and count stale reads, read-your-writes and monotonic-read violations, and run a bounded linearizability check.'
          }
          if (isFollower(data) && !(Number(data.sim?.replicationLagMs) > 0)) {
            return 'This follower has no replica lag, so it applies every write instantly and can never serve stale data. Set Replica lag to model asynchronous replication.'
          }
          return 'Tracks data versions per request key. Set the same model on the leader and every follower of this dataset; follower reads wait for replication to catch up when the model requires it, and that wait shows up as read latency. Reads and writes need a request key (keyspace); session guarantees need client sessions on the source.'
        },
        noteTone: 'info',
        fields: [
          {
            path: 'sim.consistencyModel',
            type: 'select',
            label: 'Consistency model',
            options: ['off', ...CONSISTENCY_MODELS],
            altitude: 'primary',
            visible: isReplicatedDatastore,
            why: 'Off: reads are not version-tracked. Otherwise, what a follower read must wait for before answering. Eventual answers from whatever has replicated (fast, can be stale: DynamoDB default reads, Cassandra ONE). Monotonic reads never go back in time for a session. Read-your-writes waits until the session sees its own acknowledged writes (MongoDB causal sessions, MySQL GTID waits). Strong waits for the newest committed version (Raft follower ReadIndex, DynamoDB ConsistentRead). Leader reads are always current. Stronger models cost read latency and hold workers while waiting.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'consistencyReads',
      'consistencyWrites',
      'consistencyLeaderReads',
      'consistencyFollowerReads',
      'consistencyStaleReads',
      'consistencyReadYourWritesViolations',
      'consistencyMonotonicReadViolations',
      'consistencyCatchUpWaits',
      'consistencyKeyless',
      'consistencySessionlessReads'
    ]
  },
  honesty: {
    simulates: [
      'per-key data versions committed on the leader and applied on followers after the configured replica lag (quorum-acked writes are on followers at commit)',
      'follower reads that wait for replication catch-up per consistency model, with the wait measured in read latency and worker occupancy',
      'stale-read, read-your-writes, and monotonic-read oracles over real recorded versions and client sessions',
      'a single-key register linearizability check (Wing and Gong search) over a bounded per-key history, reporting any unchecked operations'
    ],
    notModeled: [
      'the leader round trip a Raft follower read (ReadIndex) or a quorum read pays; only the catch-up wait is charged',
      'which followers form a write quorum (a quorum-acked write is treated as applied on every follower)',
      'replication lag that varies with load, failover, or partitions (lag is the configured constant)',
      'multi-key transactions, snapshot isolation, and causal consistency across different keys',
      'linearizability beyond the per-key bound or across keys (reported as not checked)'
    ]
  }
}
