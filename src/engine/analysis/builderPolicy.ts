/**
 * Per-question builder policy (custom-node-and-service-definition-spec §15).
 *
 * The Service builder and Custom Node builder create nodes that serialize as their
 * backing componentType, carrying the definition on `config.customDefinition`.
 * Grading matches on componentType only, so `allowedNodeTypes` /
 * `forbiddenNodeTypes` cannot tell "a microservice from the palette" apart from "a
 * microservice built in the Service builder". `BuilderPolicy` adds that control.
 *
 * Compatibility contract: an absent policy (and every absent field) resolves to
 * today's behaviour - both builders on, every runtime / class / trait allowed, no
 * definition cap, no lock. Only a restrictive policy adds grading checks or UI gates.
 *
 * Scope decisions:
 * - A "definition" is a node carrying a `customDefinition` (each placement forks
 *   its own copy, so definitions and created nodes are counted the same way).
 * - Nodes provided by the question scaffold are the author's and are exempt.
 * - `allowMyNodes` and `requireContracts` from the spec are not implemented (there
 *   is no My Nodes library, and contracts are documentation-only); the schema is
 *   strict so an author who writes them gets an error instead of a silent no-op.
 */
import { z } from 'zod'
import {
  RUNTIME_TEMPLATES,
  isCustomNodeDefinition,
  type CustomDefinitionKind,
  type CustomNodeClass,
  type CustomNodeDefinition,
  type RuntimeTemplateId,
  type TraitPackId
} from '../catalog/customDefinitions'
import type { TopologyJSON } from '../core/types'

export interface BuilderPolicy {
  /** Service builder (default true). */
  allowServiceBuilder?: boolean
  /** My Services (re-placing saved service definitions); also needs the Service builder. */
  allowMyServices?: boolean
  /** Custom Node builder (default true). */
  allowCustomNodeBuilder?: boolean
  /** Node classes a created definition may have. Omit = all. */
  allowedNodeClasses?: CustomNodeClass[]
  /** Runtime templates a created definition may use. Omit = all. */
  allowedRuntimeTemplates?: RuntimeTemplateId[]
  /** Trait packs a created definition may enable. Omit = all. */
  allowedTraitPacks?: TraitPackId[]
  /** Maximum created definitions (nodes carrying a definition) on the canvas. Omit = no cap. */
  maxDefinitions?: number
  /** Maximum operations a single created service may declare. Omit = no cap. */
  maxOperationsPerService?: number
  /** Definitions become read-only after the first run of the question attempt. */
  lockDefinitionsAfterFirstRun?: boolean
}

export interface ResolvedBuilderPolicy {
  allowServiceBuilder: boolean
  allowMyServices: boolean
  allowCustomNodeBuilder: boolean
  allowedNodeClasses: readonly CustomNodeClass[] | null
  allowedRuntimeTemplates: readonly RuntimeTemplateId[] | null
  allowedTraitPacks: readonly TraitPackId[] | null
  maxDefinitions: number | null
  maxOperationsPerService: number | null
  lockDefinitionsAfterFirstRun: boolean
}

export const CUSTOM_NODE_CLASS_IDS = [
  'compute',
  'storage',
  'network',
  'messaging',
  'external',
  'security',
  'observability',
  'coordination',
  'auxiliary'
] as const satisfies readonly CustomNodeClass[]

export const RUNTIME_TEMPLATE_IDS = Object.keys(RUNTIME_TEMPLATES) as RuntimeTemplateId[]

export const TRAIT_PACK_IDS = [
  'capacity',
  'workload-profile',
  'serverless-lifecycle',
  'retry-timeout',
  'rate-limiting',
  'external-dependency',
  'cache',
  'arrival'
] as const satisfies readonly TraitPackId[]

/** Node classes some runtime template actually offers (what the builder can select). */
export const BUILDER_NODE_CLASS_IDS: readonly CustomNodeClass[] = CUSTOM_NODE_CLASS_IDS.filter(
  (nodeClass) => RUNTIME_TEMPLATE_IDS.some((id) => RUNTIME_TEMPLATES[id].nodeClass === nodeClass)
)

export const TRAIT_PACK_LABELS: Record<TraitPackId, string> = {
  capacity: 'Capacity',
  'workload-profile': 'Workload profile',
  'serverless-lifecycle': 'Serverless lifecycle',
  'retry-timeout': 'Retry and timeout',
  'rate-limiting': 'Rate limiting',
  'external-dependency': 'External dependency',
  cache: 'Cache',
  arrival: 'Arrival'
}

/**
 * The node-data paths each trait pack writes (mirrors `applyDefinitionTraits`).
 * Used so a disallowed trait cannot be re-created through the properties panel or
 * the terminal on a created node, and so a locked definition stays locked there.
 */
export const TRAIT_PACK_DATA_PATHS: Record<TraitPackId, readonly string[]> = {
  capacity: [
    'sim.resources.workloadKind',
    'sim.resources.instanceCount',
    'sim.resources.workersPerInstance',
    'sim.resources.queueSlots'
  ],
  'workload-profile': ['sim.processing.distribution'],
  'serverless-lifecycle': ['sim.coldStartLatencyMs', 'sim.idleTimeoutMs', 'sim.maxConcurrency'],
  'retry-timeout': ['sim.processing.timeout', 'sim.retry.maxAttempts'],
  'rate-limiting': ['sim.maxTokens', 'sim.refillRatePerSecond'],
  'external-dependency': ['sim.nodeErrorRate'],
  cache: ['sim.cacheHitRate', 'sim.cacheHitLatencyMs'],
  arrival: ['source.defaultWorkload.baseRps', 'source.defaultWorkload.pattern']
}

export const BuilderPolicySchema: z.ZodType<BuilderPolicy> = z
  .object({
    allowServiceBuilder: z.boolean().optional(),
    allowMyServices: z.boolean().optional(),
    allowCustomNodeBuilder: z.boolean().optional(),
    allowedNodeClasses: z.array(z.enum(CUSTOM_NODE_CLASS_IDS)).optional(),
    allowedRuntimeTemplates: z
      .array(z.enum(RUNTIME_TEMPLATE_IDS as [RuntimeTemplateId, ...RuntimeTemplateId[]]))
      .optional(),
    allowedTraitPacks: z.array(z.enum(TRAIT_PACK_IDS)).optional(),
    maxDefinitions: z.number().int().nonnegative().optional(),
    maxOperationsPerService: z.number().int().positive().optional(),
    lockDefinitionsAfterFirstRun: z.boolean().optional()
  })
  .strict()

export const DEFAULT_RESOLVED_BUILDER_POLICY: ResolvedBuilderPolicy = Object.freeze({
  allowServiceBuilder: true,
  allowMyServices: true,
  allowCustomNodeBuilder: true,
  allowedNodeClasses: null,
  allowedRuntimeTemplates: null,
  allowedTraitPacks: null,
  maxDefinitions: null,
  maxOperationsPerService: null,
  lockDefinitionsAfterFirstRun: false
})

export function resolveBuilderPolicy(
  policy: BuilderPolicy | null | undefined
): ResolvedBuilderPolicy {
  if (!policy) return DEFAULT_RESOLVED_BUILDER_POLICY
  const allowServiceBuilder = policy.allowServiceBuilder ?? true
  return {
    allowServiceBuilder,
    allowMyServices: allowServiceBuilder && (policy.allowMyServices ?? true),
    allowCustomNodeBuilder: policy.allowCustomNodeBuilder ?? true,
    allowedNodeClasses: policy.allowedNodeClasses ? [...policy.allowedNodeClasses] : null,
    allowedRuntimeTemplates: policy.allowedRuntimeTemplates
      ? [...policy.allowedRuntimeTemplates]
      : null,
    allowedTraitPacks: policy.allowedTraitPacks ? [...policy.allowedTraitPacks] : null,
    maxDefinitions: policy.maxDefinitions ?? null,
    maxOperationsPerService: policy.maxOperationsPerService ?? null,
    lockDefinitionsAfterFirstRun: policy.lockDefinitionsAfterFirstRun ?? false
  }
}

/** True when the policy changes anything relative to today's behaviour. */
export function isBuilderPolicyRestrictive(policy: BuilderPolicy | null | undefined): boolean {
  const resolved = resolveBuilderPolicy(policy)
  return (
    !resolved.allowServiceBuilder ||
    !resolved.allowMyServices ||
    !resolved.allowCustomNodeBuilder ||
    resolved.allowedNodeClasses !== null ||
    resolved.allowedRuntimeTemplates !== null ||
    resolved.allowedTraitPacks !== null ||
    resolved.maxDefinitions !== null ||
    resolved.maxOperationsPerService !== null ||
    resolved.lockDefinitionsAfterFirstRun
  )
}

/** Drops absent / default fields so an all-default policy serializes as `undefined`. */
export function normalizeBuilderPolicy(
  policy: BuilderPolicy | null | undefined
): BuilderPolicy | undefined {
  if (!policy) return undefined
  const next: BuilderPolicy = {}
  if (policy.allowServiceBuilder === false) next.allowServiceBuilder = false
  if (policy.allowMyServices === false) next.allowMyServices = false
  if (policy.allowCustomNodeBuilder === false) next.allowCustomNodeBuilder = false
  if (policy.allowedNodeClasses) next.allowedNodeClasses = [...policy.allowedNodeClasses]
  if (policy.allowedRuntimeTemplates) {
    next.allowedRuntimeTemplates = [...policy.allowedRuntimeTemplates]
  }
  if (policy.allowedTraitPacks) next.allowedTraitPacks = [...policy.allowedTraitPacks]
  if (policy.maxDefinitions !== undefined) next.maxDefinitions = policy.maxDefinitions
  if (policy.maxOperationsPerService !== undefined) {
    next.maxOperationsPerService = policy.maxOperationsPerService
  }
  if (policy.lockDefinitionsAfterFirstRun) next.lockDefinitionsAfterFirstRun = true
  return Object.keys(next).length > 0 ? next : undefined
}

function definitionNodeClass(definition: CustomNodeDefinition): CustomNodeClass {
  return definition.nodeClass ?? RUNTIME_TEMPLATES[definition.runtimeTemplate].nodeClass
}

function definitionLabel(kind: CustomDefinitionKind): string {
  return kind === 'service' ? 'Service builder' : 'Custom Node builder'
}

/** Runtime templates a builder of `kind` may offer under the policy, in catalog order. */
export function allowedRuntimeTemplatesFor(
  policy: ResolvedBuilderPolicy,
  kind: CustomDefinitionKind
): RuntimeTemplateId[] {
  return RUNTIME_TEMPLATE_IDS.filter((id) => {
    const template = RUNTIME_TEMPLATES[id]
    return (
      template.allowedDefinitionKinds.includes(kind) &&
      (policy.allowedRuntimeTemplates === null || policy.allowedRuntimeTemplates.includes(id)) &&
      (policy.allowedNodeClasses === null || policy.allowedNodeClasses.includes(template.nodeClass))
    )
  })
}

export function isTraitPackAllowed(policy: ResolvedBuilderPolicy, traitId: TraitPackId): boolean {
  return policy.allowedTraitPacks === null || policy.allowedTraitPacks.includes(traitId)
}

export type BuilderPolicyViolationCode =
  | 'service-builder-disabled'
  | 'custom-node-builder-disabled'
  | 'runtime-template-not-allowed'
  | 'node-class-not-allowed'
  | 'trait-pack-not-allowed'
  | 'too-many-operations'
  | 'too-many-definitions'

export interface BuilderPolicyViolation {
  code: BuilderPolicyViolationCode
  /** Canvas / topology node ids the violation is about. */
  nodeIds: string[]
  message: string
  /** What the learner can do to fix it. */
  fix: string
}

export interface DefinitionEntry {
  nodeId: string
  label?: string
  definition: CustomNodeDefinition
}

function nameOf(entry: DefinitionEntry): string {
  return `"${entry.label?.trim() || entry.definition.name?.trim() || entry.nodeId}"`
}

function joinIds(ids: readonly string[]): string {
  return ids.join(', ')
}

/** Per-definition checks (everything except the canvas-wide definition count). */
export function checkDefinitionAgainstPolicy(
  policy: ResolvedBuilderPolicy,
  entry: DefinitionEntry
): BuilderPolicyViolation[] {
  const { definition } = entry
  const out: BuilderPolicyViolation[] = []
  const name = nameOf(entry)
  const nodeIds = [entry.nodeId]

  if (definition.kind === 'service' && !policy.allowServiceBuilder) {
    out.push({
      code: 'service-builder-disabled',
      nodeIds,
      message: `${name} was made with the Service builder, which this question does not allow.`,
      fix: `Delete ${name} and use a component from the palette instead.`
    })
  }
  if (definition.kind === 'custom-node' && !policy.allowCustomNodeBuilder) {
    out.push({
      code: 'custom-node-builder-disabled',
      nodeIds,
      message: `${name} was made with the Custom Node builder, which this question does not allow.`,
      fix: `Delete ${name} and use a component from the palette instead.`
    })
  }

  const template = RUNTIME_TEMPLATES[definition.runtimeTemplate]
  if (
    policy.allowedRuntimeTemplates !== null &&
    !policy.allowedRuntimeTemplates.includes(definition.runtimeTemplate)
  ) {
    const allowed = allowedRuntimeTemplatesFor(policy, definition.kind).map(
      (id) => RUNTIME_TEMPLATES[id].label
    )
    out.push({
      code: 'runtime-template-not-allowed',
      nodeIds,
      message: `${name} uses the "${template.label}" runtime, which this question does not allow.`,
      fix:
        allowed.length > 0
          ? `Delete ${name} and rebuild it with an allowed runtime (${allowed.join(', ')}).`
          : `Delete ${name}; the ${definitionLabel(definition.kind)} has no runtime this question allows.`
    })
  }

  const nodeClass = definitionNodeClass(definition)
  if (policy.allowedNodeClasses !== null && !policy.allowedNodeClasses.includes(nodeClass)) {
    out.push({
      code: 'node-class-not-allowed',
      nodeIds,
      message: `${name} is a ${nodeClass} node, a class this question does not allow.`,
      fix:
        policy.allowedNodeClasses.length > 0
          ? `Delete ${name} and rebuild it with an allowed class (${policy.allowedNodeClasses.join(', ')}).`
          : `Delete ${name}; this question allows no created node classes.`
    })
  }

  if (policy.allowedTraitPacks !== null) {
    const blocked = (definition.traits ?? [])
      .filter((trait) => trait.enabled && !isTraitPackAllowed(policy, trait.traitId))
      .map((trait) => TRAIT_PACK_LABELS[trait.traitId] ?? trait.traitId)
    if (blocked.length > 0) {
      out.push({
        code: 'trait-pack-not-allowed',
        nodeIds,
        message: `${name} enables trait${blocked.length === 1 ? '' : 's'} this question does not allow: ${blocked.join(', ')}.`,
        fix: `Delete ${name} and rebuild it without ${blocked.join(', ')}.`
      })
    }
  }

  if (
    definition.kind === 'service' &&
    policy.maxOperationsPerService !== null &&
    definition.operations.length > policy.maxOperationsPerService
  ) {
    out.push({
      code: 'too-many-operations',
      nodeIds,
      message: `${name} declares ${definition.operations.length} operations; this question allows at most ${policy.maxOperationsPerService} per service.`,
      fix: `Remove operations from ${name} until it has ${policy.maxOperationsPerService} or fewer.`
    })
  }

  return out
}

/** Evaluates every created definition (scaffold-exempt entries already removed). */
export function evaluateBuilderPolicy(
  resolved: ResolvedBuilderPolicy,
  entries: readonly DefinitionEntry[]
): BuilderPolicyViolation[] {
  const out = entries.flatMap((entry) => checkDefinitionAgainstPolicy(resolved, entry))
  if (resolved.maxDefinitions !== null && entries.length > resolved.maxDefinitions) {
    const extra = entries.slice(resolved.maxDefinitions).map((entry) => entry.nodeId)
    out.push({
      code: 'too-many-definitions',
      nodeIds: entries.map((entry) => entry.nodeId),
      message: `The design has ${entries.length} created definitions; this question allows at most ${resolved.maxDefinitions}.`,
      fix: `Delete ${entries.length - resolved.maxDefinitions} created node${entries.length - resolved.maxDefinitions === 1 ? '' : 's'} (for example ${joinIds(extra)}).`
    })
  }
  return out
}

/** Created definitions in an engine topology, skipping exempt (scaffold) node ids. */
export function definitionEntriesFromTopology(
  topology: Pick<TopologyJSON, 'nodes'>,
  exemptNodeIds: Iterable<string> = []
): DefinitionEntry[] {
  const exempt = new Set(exemptNodeIds)
  return topology.nodes.flatMap((node) => {
    const definition = node.config?.['customDefinition']
    if (exempt.has(node.id) || !isCustomNodeDefinition(definition)) return []
    return [{ nodeId: node.id, label: node.label, definition }]
  })
}

/** Created definitions on canvas nodes (`data.customDefinition`), skipping exempt ids. */
export function definitionEntriesFromCanvasNodes(
  nodes: ReadonlyArray<{ id: string; data?: unknown }>,
  exemptNodeIds: Iterable<string> = []
): DefinitionEntry[] {
  const exempt = new Set(exemptNodeIds)
  return nodes.flatMap((node) => {
    const data = node.data as { customDefinition?: unknown; label?: unknown } | undefined
    const definition = data?.customDefinition
    if (exempt.has(node.id) || !isCustomNodeDefinition(definition)) return []
    return [
      {
        nodeId: node.id,
        label: typeof data?.label === 'string' ? data.label : undefined,
        definition
      }
    ]
  })
}

export interface DefinitionLockInput {
  /** Graded test runs recorded on the attempt. */
  testRunCount?: number
  /** Whether the attempt carries a dry-run or submitted grade. */
  hasGrade?: boolean
  /** Simulation runs started for this question in the current session. */
  sessionRunCount?: number
}

export function areDefinitionsLocked(
  resolved: ResolvedBuilderPolicy,
  input: DefinitionLockInput
): boolean {
  if (!resolved.lockDefinitionsAfterFirstRun) return false
  return (
    (input.testRunCount ?? 0) > 0 || input.hasGrade === true || (input.sessionRunCount ?? 0) > 0
  )
}

export const DEFINITIONS_LOCKED_REASON =
  'Definitions are locked after the first run of this question attempt.'

export type BuilderEntry = 'service' | 'custom-node' | 'my-service'

export interface BuilderAvailability {
  available: boolean
  reason?: string
}

/** Whether a builder entry point (palette tile) is usable, and why not. */
export function builderAvailability(
  policy: ResolvedBuilderPolicy,
  entry: BuilderEntry,
  state: { definitionCount: number; locked: boolean }
): BuilderAvailability {
  if (entry === 'service' && !policy.allowServiceBuilder) {
    return { available: false, reason: 'This question does not allow the Service builder.' }
  }
  if (entry === 'my-service' && !policy.allowServiceBuilder) {
    return { available: false, reason: 'This question does not allow the Service builder.' }
  }
  if (entry === 'my-service' && !policy.allowMyServices) {
    return { available: false, reason: 'This question does not allow My Services.' }
  }
  if (entry === 'custom-node' && !policy.allowCustomNodeBuilder) {
    return { available: false, reason: 'This question does not allow the Custom Node builder.' }
  }
  const kind: CustomDefinitionKind = entry === 'custom-node' ? 'custom-node' : 'service'
  if (allowedRuntimeTemplatesFor(policy, kind).length === 0) {
    return {
      available: false,
      reason: `No ${kind === 'service' ? 'service' : 'custom node'} runtime is allowed by this question.`
    }
  }
  if (state.locked) {
    return { available: false, reason: DEFINITIONS_LOCKED_REASON }
  }
  if (policy.maxDefinitions !== null && state.definitionCount >= policy.maxDefinitions) {
    return {
      available: false,
      reason:
        policy.maxDefinitions === 0
          ? 'This question allows no created definitions.'
          : `This question allows at most ${policy.maxDefinitions} created definition${policy.maxDefinitions === 1 ? '' : 's'} (${state.definitionCount} on the canvas).`
    }
  }
  return { available: true }
}

/**
 * Whether adding `incoming` definitions to a canvas that already has `existing`
 * created definitions respects the policy. Used by every node-adding path (builder
 * create, My Services, paste) so none of them is a side door.
 */
export function admitDefinitions(
  policy: ResolvedBuilderPolicy,
  existing: readonly DefinitionEntry[],
  incoming: readonly DefinitionEntry[],
  locked: boolean
): { ok: true } | { ok: false; reason: string } {
  if (incoming.length === 0) return { ok: true }
  if (locked) return { ok: false, reason: DEFINITIONS_LOCKED_REASON }
  for (const entry of incoming) {
    const [first] = checkDefinitionAgainstPolicy(policy, entry)
    if (first) return { ok: false, reason: first.message }
  }
  if (policy.maxDefinitions !== null && existing.length + incoming.length > policy.maxDefinitions) {
    return {
      ok: false,
      reason: `This question allows at most ${policy.maxDefinitions} created definition${policy.maxDefinitions === 1 ? '' : 's'} (${existing.length} on the canvas).`
    }
  }
  return { ok: true }
}

function readPath(value: unknown, path: string): unknown {
  let current = value
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The trait packs a definition's runtime offers. Only their fields belong to the
 * definition; other fields of the backing component (e.g. a microservice's error
 * rate) stay ordinary node settings.
 */
function runtimeTraitPacks(definition: CustomNodeDefinition): readonly TraitPackId[] {
  return RUNTIME_TEMPLATES[definition.runtimeTemplate].traitPacks
}

/**
 * Why an edit of a created node's data from `before` to `after` is not allowed, or
 * null when it is. Covers: a locked definition (no definition or trait-backed field
 * change), and trait-backed fields of a disallowed trait pack.
 */
export function definitionEditBlockReason(
  policy: ResolvedBuilderPolicy,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  locked: boolean
): string | null {
  const beforeDefinition = before['customDefinition']
  if (!isCustomNodeDefinition(beforeDefinition)) return null
  const traitPacks = runtimeTraitPacks(beforeDefinition)
  const changed = (path: string): boolean =>
    !sameValue(readPath(before, path), readPath(after, path))

  if (locked) {
    if (changed('customDefinition')) return DEFINITIONS_LOCKED_REASON
    for (const traitId of traitPacks) {
      if (TRAIT_PACK_DATA_PATHS[traitId].some(changed)) {
        return `${DEFINITIONS_LOCKED_REASON} ${TRAIT_PACK_LABELS[traitId]} settings come from the definition.`
      }
    }
  }

  if (policy.allowedTraitPacks !== null) {
    for (const traitId of traitPacks) {
      if (isTraitPackAllowed(policy, traitId)) continue
      if (TRAIT_PACK_DATA_PATHS[traitId].some(changed)) {
        return `This question does not allow the ${TRAIT_PACK_LABELS[traitId]} trait on created nodes.`
      }
    }
    const afterDefinition = after['customDefinition']
    if (isCustomNodeDefinition(afterDefinition)) {
      const blocked = (afterDefinition.traits ?? []).find(
        (trait) => trait.enabled && !isTraitPackAllowed(policy, trait.traitId)
      )
      const wasEnabled = (before['customDefinition'] as CustomNodeDefinition).traits?.some(
        (trait) => trait.enabled && trait.traitId === blocked?.traitId
      )
      if (blocked && !wasEnabled) {
        return `This question does not allow the ${TRAIT_PACK_LABELS[blocked.traitId]} trait on created nodes.`
      }
    }
  }

  if (policy.maxOperationsPerService !== null) {
    const afterDefinition = after['customDefinition']
    if (
      isCustomNodeDefinition(afterDefinition) &&
      afterDefinition.kind === 'service' &&
      afterDefinition.operations.length > policy.maxOperationsPerService &&
      afterDefinition.operations.length >
        (before['customDefinition'] as CustomNodeDefinition).operations.length
    ) {
      return `This question allows at most ${policy.maxOperationsPerService} operations per service.`
    }
  }
  return null
}

/** Why a single field path on a created node is read-only, or null (panel / terminal). */
export function definitionFieldLockReason(
  policy: ResolvedBuilderPolicy,
  data: Record<string, unknown>,
  path: string,
  locked: boolean
): string | null {
  const definition = data['customDefinition']
  if (!isCustomNodeDefinition(definition)) return null
  for (const traitId of runtimeTraitPacks(definition)) {
    const owns = TRAIT_PACK_DATA_PATHS[traitId].some(
      (owned) => owned === path || owned.startsWith(`${path}.`) || path.startsWith(`${owned}.`)
    )
    if (!owns) continue
    if (locked) {
      return `${DEFINITIONS_LOCKED_REASON} ${TRAIT_PACK_LABELS[traitId]} settings come from the definition.`
    }
    if (!isTraitPackAllowed(policy, traitId)) {
      return `This question does not allow the ${TRAIT_PACK_LABELS[traitId]} trait on created nodes.`
    }
  }
  return null
}

/** One-line summary of a restrictive policy, for learner-facing rows. */
export function describeBuilderPolicy(policy: BuilderPolicy | null | undefined): string {
  const resolved = resolveBuilderPolicy(policy)
  const parts: string[] = []
  if (!resolved.allowServiceBuilder) parts.push('no Service builder')
  else if (!resolved.allowMyServices) parts.push('no My Services')
  if (!resolved.allowCustomNodeBuilder) parts.push('no Custom Node builder')
  if (resolved.allowedRuntimeTemplates) {
    parts.push(
      `runtimes: ${resolved.allowedRuntimeTemplates.map((id) => RUNTIME_TEMPLATES[id].label).join(', ') || 'none'}`
    )
  }
  if (resolved.allowedNodeClasses) {
    parts.push(`classes: ${resolved.allowedNodeClasses.join(', ') || 'none'}`)
  }
  if (resolved.allowedTraitPacks) {
    parts.push(
      `traits: ${resolved.allowedTraitPacks.map((id) => TRAIT_PACK_LABELS[id]).join(', ') || 'none'}`
    )
  }
  if (resolved.maxDefinitions !== null) parts.push(`at most ${resolved.maxDefinitions} created`)
  if (resolved.maxOperationsPerService !== null) {
    parts.push(`at most ${resolved.maxOperationsPerService} operations per service`)
  }
  if (resolved.lockDefinitionsAfterFirstRun) parts.push('locked after first run')
  return parts.join('; ')
}
