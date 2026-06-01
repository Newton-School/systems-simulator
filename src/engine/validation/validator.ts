import { z } from 'zod'
import { TopologyJSON } from '../core/types'
import { inferStructuralRole } from '../catalog/componentSpecs'

const COMPONENT_CATEGORIES = [
  'compute',
  'network-and-edge',
  'storage-and-data',
  'messaging-and-streaming',
  'orchestration-and-infra',
  'security-and-identity',
  'observability',
  'devops-and-delivery',
  'data-infra-and-analytics',
  'real-time-and-media',
  'external-and-integration',
  'dns-and-certs',
  'consensus-and-coordination',
  'auxiliary'
] as const

const COMPONENT_TYPES = [
  'api-endpoint',
  'microservice',
  'sidecar',
  'batch-worker',
  'serverless-function',
  'faas-background',
  'container',
  'vm-instance',
  'edge-compute',
  'gpu-node',
  'auth-service',
  'search-service',
  'load-balancer',
  'load-balancer-l4',
  'load-balancer-l7',
  'global-traffic-manager',
  'edge-router',
  'nat-gateway',
  'transit-gateway',
  'vpn-gateway',
  'cdn',
  'api-gateway',
  'service-mesh',
  'ingress-controller',
  'reverse-proxy',
  'high-perf-nic',
  'network-policy',
  'routing-rule',
  'routing-policy',
  'relational-db',
  'nosql-db',
  'object-storage',
  'block-storage',
  'distributed-file-system',
  'in-memory-cache',
  'search-index',
  'time-series-db',
  'columnar-db',
  'graph-db',
  'vector-db',
  'data-warehouse',
  'data-lake',
  'kv-store',
  'archive-storage',
  'schema-registry',
  'cdc',
  'backup-service',
  'kms-storage',
  'queue',
  'pub-sub',
  'stream',
  'event-bus',
  'event-sourcing-store',
  'message-broker',
  'task-queue',
  'kubernetes-cluster',
  'container-registry',
  'service-registry',
  'tool-registry',
  'config-store',
  'secrets-manager',
  'cluster-autoscaler',
  'agent-orchestrator',
  'orchestrator-scheduler',
  'ci-cd-runner',
  'iac-engine',
  'container-runtime',
  'provisioner',
  'iam-rbac',
  'waf',
  'firewall',
  'bastion-host',
  'certificate-authority',
  'secrets-rotation',
  'kms-security',
  'dlp-inspection',
  'identity-provider',
  'siem',
  'privilege-escalation-control',
  'centralized-logging',
  'distributed-tracing',
  'metrics-store',
  'alerting-hook',
  'dashboard',
  'rum-monitoring',
  'health-check-manager',
  'safety-observability-mesh',
  'profiling-service',
  'artifact-repository',
  'build-system',
  'feature-flag-service',
  'deployment-controller',
  'chaos-engineering-framework',
  'policy-as-code',
  'pipeline-secrets',
  'etl-pipeline',
  'streaming-analytics',
  'feature-store',
  'memory-fabric',
  'model-serving',
  'websockets-gateway',
  'push-notification-service',
  'transcoder',
  'signaling-server',
  'sfu-mcu',
  'webrtc-mesh',
  'webhook-gateway',
  'llm-gateway',
  'third-party-api-connector',
  'payment-gateway',
  'third-party-auth',
  'dns-authoritative-server',
  'internal-dns',
  'certificate-distro',
  'etcd-consul-kv',
  'leader-election',
  'distributed-lock',
  'coordination-service',
  'service-mesh-telemetry',
  'policy-engine',
  'sharding',
  'hashing',
  'shard-node',
  'partition-node',
  'rate-limiter',
  'circuit-breaker-controller',
  'idempotency-manager',
  'request-tracking',
  'backpressure-controller',
  'throttler'
] as const

//zod Schema
const BaseDistributionConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('constant'), value: z.number() }),
  z.object({ type: z.literal('deterministic'), value: z.number() }),
  z.object({
    type: z.literal('log-normal'),
    mu: z.number(),
    sigma: z.number().positive('Sigma must be > 0')
  }),
  z.object({ type: z.literal('exponential'), lambda: z.number().positive('Lambda must be > 0') }),
  z.object({ type: z.literal('normal'), mean: z.number(), stdDev: z.number().positive() }),
  z
    .object({
      type: z.literal('uniform'),
      min: z.number(),
      max: z.number()
    })
    .refine((data) => data.max > data.min, {
      message: 'For uniform distribution, max must be greater than min',
      path: ['max']
    }),
  z.object({
    type: z.literal('weibull'),
    shape: z.number().positive(),
    scale: z.number().positive()
  }),
  z.object({ type: z.literal('poisson'), lambda: z.number().positive() }),
  z.object({
    type: z.literal('binomial'),
    n: z.number().int().positive(),
    p: z.number().min(0).max(1)
  }),
  z.object({
    type: z.literal('gamma'),
    shape: z.number().positive(),
    scale: z.number().positive()
  }),
  z.object({ type: z.literal('beta'), alpha: z.number().positive(), beta: z.number().positive() }),
  z.object({
    type: z.literal('pareto'),
    scale: z.number().positive(),
    shape: z.number().positive()
  }),
  z.object({
    type: z.literal('empirical'),
    samples: z.array(z.number()).min(1),
    interpolation: z.enum(['linear', 'step'])
  })
])

export const DistributionConfigSchema = z.union([
  BaseDistributionConfigSchema,
  z.object({
    type: z.literal('mixture'),
    components: z
      .array(
        z.object({
          weight: z.number().nonnegative(),
          distribution: BaseDistributionConfigSchema
        })
      )
      .min(1)
  })
])

export const GlobalConfigSchema = z.object({
  simulationDuration: z.number().positive(),
  seed: z.string(),
  warmupDuration: z.number().nonnegative(),
  timeResolution: z.enum(['microsecond', 'millisecond']),
  defaultTimeout: z.number().positive(),
  traceSampleRate: z.number().min(0).max(1).optional()
})

export const ComponentNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(COMPONENT_TYPES),
  category: z.enum(COMPONENT_CATEGORIES),
  role: z.enum(['source', 'processor', 'storage', 'router', 'sink']).optional(),
  label: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),

  resources: z
    .object({
      cpu: z.number().positive(),
      memory: z.number().positive(),
      replicas: z.number().int().positive(),
      maxReplicas: z.number().int().positive().optional()
    })
    .optional(),

  queue: z
    .object({
      workers: z.number().int().positive('Workers must be > 0'),
      capacity: z.number().int().nonnegative('Capacity must be >= 0'),
      discipline: z.enum(['fifo', 'lifo', 'priority', 'wfq'])
    })
    .optional(),

  processing: z
    .object({
      distribution: DistributionConfigSchema,
      timeout: z.number().positive('Timeout must be > 0')
    })
    .optional(),

  dependencies: z
    .object({
      critical: z.array(z.string()),
      optional: z.array(z.string())
    })
    .optional(),

  resilience: z.record(z.string(), z.unknown()).optional(),
  slo: z.record(z.string(), z.unknown()).optional(),
  failureModes: z.array(z.record(z.string(), z.unknown())).optional(),
  scaling: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional()
})

export const EdgeDefinitionSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  mode: z.enum(['synchronous', 'asynchronous', 'streaming', 'conditional']),
  protocol: z.enum(['https', 'grpc', 'tcp', 'udp', 'websocket', 'amqp', 'kafka']),
  latency: z.object({
    distribution: DistributionConfigSchema,
    pathType: z.enum(['same-rack', 'same-dc', 'cross-zone', 'cross-region', 'internet'])
  }),
  bandwidth: z.number().positive(),
  maxConcurrentRequests: z.number().int().positive(),
  packetLossRate: z.number().min(0).max(1),
  errorRate: z.number().min(0).max(1),
  weight: z.number().optional(),
  condition: z.string().optional(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  animated: z.boolean().optional()
})

const DiurnalHourlyMultipliersSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number()
])

export const WorkloadProfileSchema = z.object({
  sourceNodeId: z.string().min(1),
  pattern: z.enum(['constant', 'poisson', 'bursty', 'diurnal', 'spike', 'sawtooth', 'replay']),

  baseRps: z.number().positive(),

  requestDistribution: z
    .array(
      z.object({
        type: z.string(),
        weight: z.number().nonnegative(),
        sizeBytes: z.number().positive()
      })
    )
    .min(1)
    .refine(
      (dist) => {
        const totalWeight = dist.reduce((acc, curr) => acc + curr.weight, 0)
        return totalWeight > 0 && Math.abs(totalWeight - 1.0) < 0.0001
      },
      { message: 'The sum of requestDistribution weights must equal 1.0' }
    ),

  diurnal: z
    .object({
      peakMultiplier: z.number(),
      hourlyMultipliers: DiurnalHourlyMultipliersSchema
    })
    .optional(),

  spike: z
    .object({
      spikeTime: z.number().nonnegative(),
      spikeRps: z.number().nonnegative(),
      spikeDuration: z.number().nonnegative()
    })
    .optional(),

  bursty: z
    .object({
      burstRps: z.number().nonnegative(),
      burstDuration: z.number().nonnegative(),
      normalDuration: z.number().nonnegative()
    })
    .refine((config) => config.burstDuration + config.normalDuration > 0, {
      message: 'bursty.burstDuration + bursty.normalDuration must be > 0'
    })
    .optional(),

  sawtooth: z
    .object({
      peakRps: z.number().nonnegative(),
      rampDuration: z.number().nonnegative()
    })
    .optional()
})

export const FaultSpecSchema = z.object({
  targetId: z.string().min(1),
  faultType: z.string().min(1),
  timing: z.enum(['deterministic', 'probabilistic', 'conditional']),
  duration: z.enum(['fixed', 'until', 'permanent']),
  params: z.record(z.string(), z.unknown())
})

export const InvariantCheckSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  condition: z.string().min(1)
})

export const ScenarioRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  overrides: z.record(z.string(), z.unknown())
})

export const TopologyJSONSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  global: GlobalConfigSchema,
  nodes: z.array(ComponentNodeSchema),
  edges: z.array(EdgeDefinitionSchema),
  workload: WorkloadProfileSchema.optional(),

  faults: z.array(FaultSpecSchema).optional(),
  invariants: z.array(InvariantCheckSchema).optional(),
  scenarios: z.array(ScenarioRefSchema).optional()
})

//Validation Wrapper
export interface ValidationError {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  data?: TopologyJSON
  errors?: ValidationError[]
  warnings?: string[]
}

function resolvedRole(node: TopologyJSON['nodes'][number]) {
  return node.role ?? inferStructuralRole(node.type)
}

function isSourceNode(node: TopologyJSON['nodes'][number], topology: TopologyJSON): boolean {
  return resolvedRole(node) === 'source' || topology.workload?.sourceNodeId === node.id
}

function collectReachableNodeIds(
  startNodeIds: string[],
  adjacencyList: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>()
  const queue = [...startNodeIds]

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (visited.has(current)) {
      continue
    }

    visited.add(current)

    for (const neighbor of adjacencyList.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor)
      }
    }
  }

  return visited
}

export const validateTopology = (input: unknown): ValidationResult => {
  const warnings: string[] = []
  const errors: ValidationError[] = []

  //Zod Structural Parse
  const parseResult = TopologyJSONSchema.safeParse(input)
  if (!parseResult.success) {
    errors.push(
      ...parseResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    )
    return { valid: false, errors, warnings }
  }

  const topology = parseResult.data as unknown as TopologyJSON

  //Cross-Reference Validations
  const nodeIds = new Set<string>()
  const nodeById = new Map<string, TopologyJSON['nodes'][number]>()
  const edgeIds = new Set<string>()
  let hasSourceNode = false

  const incomingCount = new Map<string, number>()
  const outgoingCount = new Map<string, number>()
  const adjacencyList = new Map<string, string[]>()

  //Check Nodes
  topology.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      errors.push({ path: `nodes[${index}].id`, message: `Duplicate node ID: ${node.id}` })
    }
    nodeIds.add(node.id)
    nodeById.set(node.id, node)
    incomingCount.set(node.id, 0)
    outgoingCount.set(node.id, 0)
    adjacencyList.set(node.id, [])

    if (isSourceNode(node, topology)) {
      hasSourceNode = true
    }

    const role = resolvedRole(node)

    if (role !== 'source') {
      if (!node.queue) {
        warnings.push(
          `Node '${node.label}' is missing queue config; applying legacy default queue settings.`
        )
        node.queue = { workers: 1, capacity: 100, discipline: 'fifo' }
      }

      if (!node.processing) {
        warnings.push(
          `Node '${node.label}' is missing processing config; applying legacy default processing settings.`
        )
        node.processing = {
          distribution: { type: 'constant', value: 1 },
          timeout: 30_000
        }
      }
    }

    if (node.queue && node.queue.capacity < node.queue.workers) {
      errors.push({
        path: `nodes[${index}].queue.capacity`,
        message: 'queue.capacity must be greater than or equal to queue.workers.'
      })
    }

    if (node.processing && node.processing.timeout <= 0) {
      errors.push({
        path: `nodes[${index}].processing.timeout`,
        message: 'processing.timeout must be greater than 0.'
      })
    }

    const nodeErrorRate = node.config?.['nodeErrorRate']
    if (
      nodeErrorRate !== undefined &&
      (typeof nodeErrorRate !== 'number' ||
        !Number.isFinite(nodeErrorRate) ||
        nodeErrorRate < 0 ||
        nodeErrorRate > 1)
    ) {
      errors.push({
        path: `nodes[${index}].config.nodeErrorRate`,
        message: 'nodeErrorRate must be between 0 and 1.'
      })
    }

    if (role === 'sink' && node.config?.['routingStrategy'] !== undefined) {
      errors.push({
        path: `nodes[${index}].config.routingStrategy`,
        message: 'Sink nodes cannot expose routing configuration.'
      })
    }

    if (node.type === 'waf' || node.type === 'firewall') {
      const securityPolicy = node.config?.['securityPolicy']
      const blockRate =
        securityPolicy && typeof securityPolicy === 'object'
          ? (securityPolicy as Record<string, unknown>)['blockRate']
          : undefined
      const droppedPackets =
        securityPolicy && typeof securityPolicy === 'object'
          ? (securityPolicy as Record<string, unknown>)['droppedPackets']
          : undefined

      const hasSecurityKnob =
        (typeof blockRate === 'number' && blockRate > 0) ||
        (typeof droppedPackets === 'number' && droppedPackets > 0)

      if (!hasSecurityKnob) {
        errors.push({
          path: `nodes[${index}].config.securityPolicy`,
          message: 'Security filter nodes require blockRate or droppedPackets.'
        })
      }
    }
  })

  const workloadSourceNodeId = topology.workload?.sourceNodeId
  if (workloadSourceNodeId && !nodeIds.has(workloadSourceNodeId)) {
    errors.push({
      path: 'workload.sourceNodeId',
      message: 'Workload sourceNodeId references non-existent node.'
    })
  }

  if (!hasSourceNode && topology.nodes.length > 0) {
    errors.push({
      path: 'nodes',
      message:
        'Topology must contain at least one source node (e.g., api-gateway) or a workload sourceNodeId.'
    })
  }

  //Check Edges & Dependency References
  topology.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      errors.push({ path: `edges[${index}].id`, message: `Duplicate edge ID: ${edge.id}` })
    }
    edgeIds.add(edge.id)

    if (!nodeIds.has(edge.source)) {
      errors.push({
        path: `edges[${index}].source`,
        message: `Source node ID '${edge.source}' does not exist.`
      })
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({
        path: `edges[${index}].target`,
        message: `Target node ID '${edge.target}' does not exist.`
      })
    }

    if (adjacencyList.has(edge.source) && adjacencyList.has(edge.target)) {
      adjacencyList.get(edge.source)!.push(edge.target)
      outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1)
      incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
    }
  })

  topology.nodes.forEach((node, index) => {
    node.dependencies?.optional?.forEach((depId, depIndex) => {
      if (!nodeIds.has(depId)) {
        errors.push({
          path: `nodes[${index}].dependencies.optional[${depIndex}]`,
          message: `Optional dependency ID '${depId}' does not exist.`
        })
      }
    })
  })

  //Check that Faults target valid nodes or edges
  topology.faults?.forEach((fault, index) => {
    if (!nodeIds.has(fault.targetId) && !edgeIds.has(fault.targetId)) {
      errors.push({
        path: `faults[${index}].targetId`,
        message: `Fault target ID '${fault.targetId}' does not match any existing node or edge.`
      })
    }
  })

  //Check Time Logic
  if (topology.global.simulationDuration <= topology.global.warmupDuration) {
    errors.push({
      path: 'global.simulationDuration',
      message: 'simulationDuration must be greater than warmupDuration.'
    })
  }

  if (errors.length === 0 && workloadSourceNodeId) {
    const selectedSourceNode = nodeById.get(workloadSourceNodeId)
    const reachableFromSelectedSource = collectReachableNodeIds(
      [workloadSourceNodeId],
      adjacencyList
    )
    const hasReachableDownstreamRuntimeNode = [...reachableFromSelectedSource].some((nodeId) => {
      if (nodeId === workloadSourceNodeId) {
        return false
      }

      const reachableNode = nodeById.get(nodeId)
      return reachableNode !== undefined && !isSourceNode(reachableNode, topology)
    })

    if (selectedSourceNode && !hasReachableDownstreamRuntimeNode) {
      errors.push({
        path: 'workload.sourceNodeId',
        message: `'${selectedSourceNode.label}' is not connected to any downstream component that can be simulated. Connect it to at least one service, router, database, or external API.`
      })
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  //Graph Connectivity Check (Warnings only)
  const sourceNodeIds = topology.nodes
    .filter((node) => isSourceNode(node, topology))
    .map((n) => n.id)
  const visited = collectReachableNodeIds(sourceNodeIds, adjacencyList)

  topology.edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) {
      return
    }

    if (edge.source === edge.target) {
      warnings.push(`Edge '${edge.id}' forms a self-loop on node '${sourceNode.label}'.`)
    }

    if (
      edge.source !== edge.target &&
      isSourceNode(sourceNode, topology) &&
      isSourceNode(targetNode, topology)
    ) {
      warnings.push(
        `Edge '${edge.id}' connects source node '${sourceNode.label}' to source node '${targetNode.label}'.`
      )
    }
  })

  topology.nodes.forEach((node) => {
    const role = resolvedRole(node)
    const incoming = incomingCount.get(node.id) ?? 0
    const outgoing = outgoingCount.get(node.id) ?? 0

    if (role === 'source' && incoming > 0) {
      warnings.push(`Source node '${node.label}' has ${incoming} incoming edge(s).`)
    }

    if (role === 'sink' && outgoing > 0) {
      warnings.push(`Sink node '${node.label}' has ${outgoing} outgoing edge(s).`)
    }

    if (role === 'router' && outgoing <= 1 && node.config?.['routingStrategy'] !== undefined) {
      warnings.push(
        `Router node '${node.label}' exposes routing strategy but has ${outgoing} outgoing edge(s).`
      )
    }

    if (!visited.has(node.id)) {
      warnings.push(
        `Node '${node.id}' (${node.label}) is disconnected and unreachable from any source node.`
      )
    }
  })

  return { valid: true, data: topology, warnings }
}
