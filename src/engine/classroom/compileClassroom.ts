/**
 * The Classroom compile step: a Classroom design (structure, copy counts) plus the
 * question's givens → an ordinary engine topology and grading package.
 *
 * It runs on every Classroom run and every Classroom grade, always from the raw
 * design, and rebuilds every node from its card. Whatever engine config a
 * submission carries is discarded, so a hand-edited capacity never counts and
 * fixing a given in the question fixes every attempt on re-grade.
 *
 * Two guarantees (tested in compileClassroom.test.ts):
 *  - Both simulation paths agree. Compute nodes use the plain queue model (no
 *    instance resources), so the per-request engine and the analytic model read
 *    the same `workers ÷ service time` capacity.
 *  - Nothing hidden changes the result. Edges are connectors, service time is
 *    fixed, there are no random errors, retries, faults or locations.
 */
import { componentTypeSatisfies } from '../catalog/componentFamilies'
import { getPaletteTemplate } from '../catalog/paletteTemplates'
import type { StructuralRule } from '../analysis/structural'
import type { RubricCheck } from '../analysis/rubric'
import type { QuestionPackage, QuestionSuiteCase } from '../analysis/question'
import { peakOfferedRps } from '../analysis/fluidModel'
import type {
  ComponentNode,
  ComponentType,
  EdgeDefinition,
  GlobalConfig,
  InvariantCheck,
  TopologyJSON,
  WorkloadProfile
} from '../core/types'
import {
  conceptCardForType,
  defaultCardGivens,
  getConceptCard,
  type ConceptCard,
  type ConceptCardId
} from './conceptCards'
import {
  classroomCopies,
  type CardGivens,
  type ClassroomCheck,
  type ClassroomNamedChoice,
  type ClassroomSettings
} from './types'

/** Target per-request service time for a compute copy; queueing stays negligible. */
const TARGET_SERVICE_MS = 10
/** Fewest workers per compute copy, so small capacities still queue like a fleet. */
const MIN_WORKERS_PER_COPY = 8
/** Concurrency for passthrough components (load balancers): effectively unlimited. */
const PASSTHROUGH_WORKERS = 1_000_000
const CLASSROOM_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ERROR_RATE = 0.01
/** Classroom traffic is one kind of request; the mix isn't the lesson. */
const DEFAULT_REQUEST_MIX: WorkloadProfile['requestDistribution'] = [
  { type: 'read', weight: 1, sizeBytes: 100 }
]

/** What a compiled node records about its card, for the results card and copy metrics. */
export interface ClassroomNodeInfo {
  card: ConceptCardId
  copies: number
  capacityRps?: number
  costPerHour?: number
  latencyMs?: number
  choices?: Record<string, string>
}

export interface ClassroomIssue {
  nodeId: string
  message: string
}

export interface ClassroomCompileResult {
  topology: TopologyJSON
  /** Components Classroom mode can't model. A run should not trust the result; grading fails. */
  issues: ClassroomIssue[]
}

export interface ClassroomCompileOptions {
  settings?: ClassroomSettings
  abstraction?: 'classroom' | 'guided'
  /** Workload for this run (the question's public traffic). Omitted = keep the design's. */
  workload?: Partial<WorkloadProfile>
  global?: Partial<GlobalConfig>
}

function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, root)
}

function writePath<T extends object>(root: T, path: string, value: unknown): T {
  const clone = structuredClone(root)
  const parts = path.split('.').filter(Boolean)
  let cursor = clone as Record<string, unknown>
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value
    else {
      const child = cursor[part]
      cursor[part] = child && typeof child === 'object' ? child : {}
      cursor = cursor[part] as Record<string, unknown>
    }
  })
  return clone
}

function applyGuidedKnobs(
  compiled: ComponentNode,
  raw: ComponentNode,
  settings: ClassroomSettings | undefined
): ComponentNode {
  return (settings?.guidedKnobs ?? []).reduce((node, knob) => {
    const value = readPath(raw, knob.path)
    return value === undefined ? node : writePath(node, knob.path, value)
  }, compiled)
}

function selectedChoiceValue(
  choice: ClassroomNamedChoice,
  selected: Record<string, string>
): string | undefined {
  const selectedId = selected[choice.id] ?? choice.options[0]?.id
  return choice.options.find((option) => option.id === selectedId)?.value
}

/** Resolved givens for one component in this question: question override → card default. */
export interface ResolvedGivens extends CardGivens {
  label: string
}

function givensOverride(
  type: string,
  settings: ClassroomSettings | undefined
): ResolvedGivens | Partial<ResolvedGivens> {
  const givens = settings?.givens
  if (!givens) return {}
  if (givens[type]) return givens[type]
  const familyKey = Object.keys(givens).find((key) => componentTypeSatisfies(type, key))
  return familyKey ? givens[familyKey] : {}
}

export function resolveClassroomGivens(
  card: ConceptCard,
  type: string,
  settings: ClassroomSettings | undefined
): ResolvedGivens {
  const override = givensOverride(type, settings)
  return {
    ...defaultCardGivens(card),
    ...Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined)),
    label: override.label ?? card.label
  }
}

/** The lecture label for a component type in this question. */
export function classroomLabelForType(
  type: string,
  settings: ClassroomSettings | undefined
): string | undefined {
  const card = conceptCardForType(type)
  return card ? resolveClassroomGivens(card, type, settings).label : undefined
}

export function classroomNodeInfo(
  node: Pick<ComponentNode, 'config'>
): ClassroomNodeInfo | undefined {
  const marker = node.config?.classroom
  return marker && typeof marker === 'object' ? (marker as ClassroomNodeInfo) : undefined
}

function clampCopies(card: ConceptCard, copies: number): number {
  if (!card.copies) return 1
  return Math.min(card.copies.max, Math.max(card.copies.min, copies))
}

const ROLE_BY_CARD_ROLE = {
  source: 'source',
  passthrough: 'router',
  compute: 'processor'
} as const satisfies Record<ConceptCard['role'], ComponentNode['role']>

/** A node still named after its palette tile ("API Server") takes the lecture label. */
function classroomNodeLabel(
  raw: ComponentNode,
  card: ConceptCard,
  settings: ClassroomSettings | undefined
): string {
  const paletteLabels = card.templateIds.map((id) => getPaletteTemplate(id)?.label)
  return !raw.label.trim() || paletteLabels.includes(raw.label)
    ? resolveClassroomGivens(card, raw.type, settings).label
    : raw.label
}

function compileNode(
  raw: ComponentNode,
  card: ConceptCard,
  settings: ClassroomSettings | undefined,
  issues: ClassroomIssue[],
  outgoingEdges: number
): ComponentNode {
  const rawMarker = raw.config?.classroom as ClassroomNodeInfo | undefined
  const authoredChoices = settings?.choices?.[raw.type] ?? []
  const choices = Object.fromEntries(
    authoredChoices.flatMap((choice) => {
      const selected = rawMarker?.choices?.[choice.id]
      const valid = choice.options.some((option) => option.id === selected)
      const fallback = choice.options[0]?.id
      return valid && selected ? [[choice.id, selected]] : fallback ? [[choice.id, fallback]] : []
    })
  )
  const routingChoice = authoredChoices.find((choice) => choice.target === 'routing-strategy')
  const cacheChoice = authoredChoices.find((choice) => choice.target === 'cache-enabled')
  const routingStrategy = routingChoice ? selectedChoiceValue(routingChoice, choices) : undefined
  const cacheEnabled = cacheChoice ? selectedChoiceValue(cacheChoice, choices) !== 'off' : undefined
  const base: ComponentNode = {
    id: raw.id,
    type: raw.type,
    category: raw.category,
    role: card.nodeRole ?? ROLE_BY_CARD_ROLE[card.role],
    label: classroomNodeLabel(raw, card, settings),
    position: raw.position
  }

  if (card.role === 'source') {
    return { ...base, config: { classroom: { card: card.id, copies: 1, choices } } }
  }

  if (card.role === 'passthrough') {
    const distributesTraffic = card.id === 'load-balancer'
    return {
      ...base,
      queue: { workers: PASSTHROUGH_WORKERS, capacity: PASSTHROUGH_WORKERS, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 0 }, timeout: CLASSROOM_TIMEOUT_MS },
      config: {
        // Load balancers use the simple even-split model. Other passthrough cards
        // retain only their conceptual position; Classroom must not invent routing
        // semantics for gateways, CDNs or queues.
        ...(routingStrategy
          ? { routingStrategy }
          : distributesTraffic && outgoingEdges > 1
            ? { routingStrategy: 'round-robin' as const }
            : {}),
        ...(distributesTraffic ? { healthCheckEnabled: false } : {}),
        classroom: { card: card.id, copies: 1, choices }
      }
    }
  }

  const givens = resolveClassroomGivens(card, raw.type, settings)
  const copies = clampCopies(card, classroomCopies(raw))
  const capacityRps = givens.capacityRps
  if (capacityRps === undefined) {
    issues.push({
      nodeId: raw.id,
      message: `${raw.label} has no capacity. Add a capacity given for '${raw.type}' to the question.`
    })
    return { ...base, config: { classroom: { card: card.id, copies, choices } } }
  }

  // capacity = workers ÷ service time, exactly, in both engines.
  const workersPerCopy = Math.max(
    MIN_WORKERS_PER_COPY,
    Math.round((capacityRps * TARGET_SERVICE_MS) / 1000)
  )
  const serviceMs = (1000 * workersPerCopy) / capacityRps
  // A hit rate decides how much traffic reaches the next component, so it must be
  // stated. Never fall back to an invented default.
  if (cacheEnabled && givens.cacheHitRate === undefined) {
    issues.push({
      nodeId: raw.id,
      message: `${givens.label} has caching turned on but no stated hit rate. Add a cache hit-rate given for '${raw.type}' to the question.`
    })
  }
  const workers = workersPerCopy * copies
  const info: ClassroomNodeInfo = {
    card: card.id,
    copies,
    capacityRps,
    ...(givens.costPerHour !== undefined ? { costPerHour: givens.costPerHour } : {}),
    ...(givens.latencyMs !== undefined ? { latencyMs: givens.latencyMs } : {}),
    ...(Object.keys(choices).length > 0 ? { choices } : {})
  }
  return {
    ...base,
    queue: { workers, capacity: workers * 2, discipline: 'fifo' },
    processing: {
      distribution: { type: 'constant', value: serviceMs },
      timeout: CLASSROOM_TIMEOUT_MS
    },
    config: {
      ...(routingStrategy ? { routingStrategy } : {}),
      ...(cacheEnabled !== undefined
        ? { cacheHitRate: cacheEnabled ? (givens.cacheHitRate ?? 0) : 0 }
        : {}),
      classroom: info
    }
  }
}

/** Connector edge: topology only, no latency, loss, errors, bandwidth or connection model. */
export function neutralClassroomEdge(
  edge: EdgeDefinition,
  fixedDelayMs = 0,
  mode: EdgeDefinition['mode'] = 'synchronous'
): EdgeDefinition {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.label ? { label: edge.label } : {}),
    mode,
    protocol: edge.protocol,
    latency: {
      distribution: { type: 'constant', value: fixedDelayMs },
      pathType: 'same-rack',
      derivedFromPathType: false
    },
    bandwidth: Number.MAX_SAFE_INTEGER,
    maxConcurrentRequests: Number.MAX_SAFE_INTEGER,
    protocolOverheadMs: 0,
    packetLossRate: 0,
    errorRate: 0
  }
}

function compileWorkload(
  raw: TopologyJSON,
  nodes: readonly ComponentNode[],
  override: Partial<WorkloadProfile> | undefined
): WorkloadProfile | undefined {
  const sources = nodes.filter((node) => node.role === 'source')
  const sourceNodeId =
    sources.find((node) => node.id === raw.workload?.sourceNodeId)?.id ?? sources[0]?.id
  if (!sourceNodeId) return raw.workload
  const merged = { ...raw.workload, ...override }
  const baseRps = merged.baseRps
  if (typeof baseRps !== 'number' || !(baseRps > 0)) return raw.workload
  return {
    sourceNodeId,
    pattern: merged.pattern ?? 'constant',
    baseRps,
    requestDistribution:
      merged.requestDistribution && merged.requestDistribution.length > 0
        ? merged.requestDistribution
        : DEFAULT_REQUEST_MIX,
    ...(merged.bursty ? { bursty: merged.bursty } : {}),
    ...(merged.spike ? { spike: merged.spike } : {}),
    ...(merged.sawtooth ? { sawtooth: merged.sawtooth } : {}),
    ...(merged.diurnal ? { diurnal: merged.diurnal } : {}),
    ...(merged.stopCondition ? { stopCondition: merged.stopCondition } : {})
  } as WorkloadProfile
}

/** Rebuild a raw design as a Classroom engine topology. Pure; never mutates its input. */
export function compileClassroomTopology(
  raw: TopologyJSON,
  options: ClassroomCompileOptions = {}
): ClassroomCompileResult {
  const issues: ClassroomIssue[] = []
  const outgoing = new Map<string, number>()
  for (const edge of raw.edges) outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
  const nodes = raw.nodes.map((node) => {
    const card = conceptCardForType(node.type)
    if (!card) {
      issues.push({
        nodeId: node.id,
        message: `${node.label} (${node.type}) isn't available in Classroom mode.`
      })
      return node
    }
    const compiled = compileNode(node, card, options.settings, issues, outgoing.get(node.id) ?? 0)
    return options.abstraction === 'guided'
      ? applyGuidedKnobs(compiled, node, options.settings)
      : compiled
  })

  const workload = compileWorkload(raw, nodes, options.workload)
  const topology: TopologyJSON = {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    global: { ...raw.global, warmupDuration: 0, ...options.global },
    nodes,
    edges: raw.edges.map((edge) => {
      const target = raw.nodes.find((node) => node.id === edge.target)
      const card = target ? conceptCardForType(target.type) : undefined
      const fixedDelayMs = card
        ? (resolveClassroomGivens(card, target!.type, options.settings).latencyMs ?? 0)
        : 0
      const source = raw.nodes.find((node) => node.id === edge.source)
      const sourceChoices = source
        ? ((source.config?.classroom as ClassroomNodeInfo | undefined)?.choices ?? {})
        : {}
      const edgeModeChoice = source
        ? (options.settings?.choices?.[source.type] ?? []).find(
            (choice) => choice.target === 'outgoing-edge-mode'
          )
        : undefined
      const selectedMode = edgeModeChoice
        ? selectedChoiceValue(edgeModeChoice, sourceChoices)
        : undefined
      const mode = selectedMode === 'asynchronous' ? 'asynchronous' : 'synchronous'
      return neutralClassroomEdge(edge, fixedDelayMs, mode)
    }),
    ...(workload ? { workload } : {})
  }
  return { topology, issues }
}

// ── Question compile ───────────────────────────────────────────────────────

/** The public traffic a Classroom run uses: the dry-run case, else the stated peak. */
export function classroomRunConditions(
  pkg: Pick<QuestionPackage, 'suite' | 'prompt'>
): Pick<ClassroomCompileOptions, 'workload' | 'global'> {
  const dryRun = pkg.suite.dryRunCase
  if (dryRun?.workload?.baseRps) {
    return {
      workload: dryRun.workload,
      ...(dryRun.global ? { global: dryRun.global } : {})
    }
  }
  const peak = pkg.prompt.scale.peakRps
  return peak && peak > 0 ? { workload: { pattern: 'constant', baseRps: peak } } : {}
}

function primaryPeak(pkg: Pick<QuestionPackage, 'suite' | 'prompt'>): number {
  const workload = pkg.suite.cases[0]?.workload ?? pkg.suite.dryRunCase?.workload
  if (workload?.baseRps) {
    return peakOfferedRps({ sourceNodeId: '', pattern: 'constant', ...workload } as WorkloadProfile)
  }
  return pkg.prompt.scale.peakRps ?? 0
}

/**
 * Smallest number of copies of `component` that serves the primary case's peak
 * within the utilization target. Null when the capacity isn't known.
 */
export function minimumClassroomCopies(
  pkg: Pick<QuestionPackage, 'suite' | 'prompt' | 'classroom'>,
  component: string
): number | null {
  const card = conceptCardForType(component)
  if (!card || card.role !== 'compute') return null
  const capacity = resolveClassroomGivens(card, component, pkg.classroom).capacityRps
  const peak = primaryPeak(pkg)
  if (!capacity || !(peak > 0)) return null
  const target = pkg.classroom?.targets?.maxUtilization ?? 1
  return Math.max(1, Math.ceil(peak / (capacity * target) - 1e-9))
}

function componentName(type: string, settings: ClassroomSettings | undefined): string {
  return classroomLabelForType(type, settings) ?? type
}

export function isFeedbackCheck(check: ClassroomCheck): boolean {
  return check.severity === 'feedback'
}

/** The component type a Users node uses. */
const SOURCE_TYPE = getConceptCard('users').covers[0]

interface CompiledChecks {
  structuralRules: StructuralRule[]
  invariants: InvariantCheck[]
  rubricChecks: RubricCheck[]
}

function compileChecks(
  pkg: Pick<QuestionPackage, 'suite' | 'prompt' | 'classroom'>,
  checks: readonly ClassroomCheck[]
): CompiledChecks {
  const settings = pkg.classroom
  const compiled: CompiledChecks = { structuralRules: [], invariants: [], rubricChecks: [] }
  const points = (check: ClassroomCheck): number => check.points ?? 1

  for (const check of checks) {
    if (isFeedbackCheck(check)) continue
    switch (check.template) {
      case 'traffic-flows-through': {
        const via = check.via as ComponentType
        const component = check.component as ComponentType
        compiled.structuralRules.push(
          {
            id: `${check.id}.into`,
            description: `${check.label} (${componentName(SOURCE_TYPE, settings)} → ${componentName(via, settings)})`,
            kind: 'requires_edge',
            fromType: SOURCE_TYPE,
            toType: via
          },
          {
            id: `${check.id}.onward`,
            description: `${check.label} (${componentName(via, settings)} → ${componentName(component, settings)})`,
            kind: 'requires_edge',
            fromType: via,
            toType: component
          }
        )
        break
      }
      case 'serves-all-traffic':
        compiled.rubricChecks.push({
          id: check.id,
          description: check.label,
          kind: 'simulation',
          metric: 'summary.errorRate',
          op: '<',
          value: settings?.targets?.maxErrorRate ?? DEFAULT_MAX_ERROR_RATE,
          points: points(check)
        })
        break
      case 'within-target-utilization': {
        const target = settings?.targets?.maxUtilization ?? 1
        compiled.invariants.push({
          id: `classroom.${check.id}`,
          description: check.label,
          condition: `perNode.maxUtilization <= ${target}`
        })
        compiled.rubricChecks.push({
          id: check.id,
          description: check.label,
          kind: 'invariant',
          metric: 'invariantViolations.count',
          op: '==',
          value: 0,
          points: points(check)
        })
        break
      }
      case 'right-sized': {
        const component = check.component as string
        const minimum = minimumClassroomCopies(pkg, component)
        if (minimum === null) break
        compiled.rubricChecks.push({
          id: check.id,
          description: check.label,
          kind: 'topology',
          metric: `topology.copies.${component}`,
          op: '<=',
          value: Math.floor(minimum * (check.factor ?? 1.5)),
          points: points(check)
        })
        break
      }
    }
  }
  return compiled
}

/**
 * The grading package for a Classroom launch. When the question authors Classroom
 * checks, they replace the authored structural rules, case invariants and rubric
 * checks (those may read engine details Classroom mode hides). Instance-model
 * constraints and cost budgets are dropped: Classroom designs have no instances.
 */
export function compileClassroomQuestion(pkg: QuestionPackage): QuestionPackage {
  const { maxTotalWorkers: _workers, maxBudget: _budget, ...constraints } = pkg.constraints
  void _workers
  void _budget
  const base: QuestionPackage = {
    ...pkg,
    constraints,
    ...(pkg.budget && pkg.budget.unit !== 'cost' ? { budget: pkg.budget } : { budget: undefined })
  }
  const checks = pkg.classroom?.checks ?? []
  if (checks.length === 0) return base

  const compiled = compileChecks(pkg, checks)
  const withInvariants = (testCase: QuestionSuiteCase): QuestionSuiteCase => ({
    ...testCase,
    invariants: compiled.invariants
  })
  return {
    ...base,
    structuralRules: compiled.structuralRules,
    suite: {
      ...pkg.suite,
      cases: pkg.suite.cases.map(withInvariants),
      ...(pkg.suite.dryRunCase ? { dryRunCase: withInvariants(pkg.suite.dryRunCase) } : {})
    },
    rubric: { ...pkg.rubric, checks: compiled.rubricChecks }
  }
}

// ── Feedback (never scored) ────────────────────────────────────────────────

export interface ClassroomFeedbackResult {
  id: string
  label: string
  passed: boolean
  detail?: string
}

/** Feedback-only checks, evaluated on the compiled design. Shown, never scored. */
export function evaluateClassroomFeedback(
  pkg: Pick<QuestionPackage, 'suite' | 'prompt' | 'classroom'>,
  compiled: TopologyJSON
): ClassroomFeedbackResult[] {
  const results: ClassroomFeedbackResult[] = []
  for (const check of pkg.classroom?.checks ?? []) {
    if (!isFeedbackCheck(check) || check.template !== 'right-sized') continue
    const component = check.component as string
    const minimum = minimumClassroomCopies(pkg, component)
    if (minimum === null) continue
    const limit = Math.floor(minimum * (check.factor ?? 1.5))
    const copies = compiled.nodes
      .filter((node) => componentTypeSatisfies(node.type, component))
      .reduce((sum, node) => sum + classroomCopies(node), 0)
    const name = componentName(component, pkg.classroom).toLowerCase()
    // Never name the smallest fleet: working that out is the lesson.
    results.push({
      id: check.id,
      label: check.label,
      passed: copies <= limit,
      ...(copies > limit
        ? { detail: `${copies} ${name} instances is much more than this traffic needs.` }
        : {})
    })
  }
  return results
}
