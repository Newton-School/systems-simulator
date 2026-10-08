import type { SimulationOutput } from '../../../engine/analysis/output'
import type { EdgeDefinition, TopologyJSON } from '../../../engine/core/types'
import { runSimulation } from '../../../engine/runSimulation'
import { validateTopology } from '../../../engine/validation/validator'
import { palette } from '../../ansi'
import { createStaticDeps } from '../staticDeps'
import { TerminalSession } from '../session'
import type { CommandDeps } from '../types'

export function edge(id: string, source: string, target: string, latencyMs = 1): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: latencyMs }, pathType: 'same-dc' },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

/**
 * client -> gw -> api -> db, api -> cache. `api` is deliberately undersized
 * (1 worker, K = 2, 30 ms service at 100 req/s) so the run rejects requests.
 */
export function fixtureTopology(): TopologyJSON {
  return {
    id: 'terminal-fixture',
    name: 'Terminal fixture',
    version: '2.0.0',
    global: {
      simulationDuration: 2_000,
      seed: 'terminal-seed',
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1_000,
      traceSampleRate: 1
    },
    nodes: [
      {
        id: 'client',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'Client',
        position: { x: 0, y: 0 }
      },
      {
        id: 'gw',
        type: 'api-gateway',
        category: 'network-and-edge',
        role: 'processor',
        label: 'Gateway',
        position: { x: 100, y: 0 },
        queue: { workers: 50, capacity: 500, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 }
      },
      {
        id: 'api',
        type: 'microservice',
        category: 'compute',
        role: 'processor',
        label: 'API',
        position: { x: 200, y: 0 },
        queue: { workers: 1, capacity: 2, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 30 }, timeout: 1_000 }
      },
      {
        id: 'db',
        type: 'relational-db',
        category: 'storage-and-data',
        role: 'processor',
        label: 'Orders DB',
        position: { x: 300, y: 0 },
        queue: { workers: 10, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 2 }, timeout: 1_000 }
      },
      {
        id: 'cache',
        type: 'in-memory-cache',
        category: 'storage-and-data',
        role: 'processor',
        label: 'Cache',
        position: { x: 300, y: 100 },
        queue: { workers: 10, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 }
      }
    ],
    edges: [
      edge('client-gw', 'client', 'gw', 2),
      edge('gw-api', 'gw', 'api', 1),
      edge('api-db', 'api', 'db', 1),
      edge('api-cache', 'api', 'cache', 0.5)
    ],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1_024 }]
    }
  } as TopologyJSON
}

export const NO_COLOR = palette(false)

export function validateView(topology: TopologyJSON) {
  const result = validateTopology(topology)
  return { valid: result.valid, errors: result.errors ?? [], warnings: result.warnings ?? [] }
}

let cachedRun: SimulationOutput | null = null

/** One shared run of the fixture (deterministic seed). */
export function fixtureRun(): SimulationOutput {
  cachedRun ??= runSimulation(fixtureTopology(), { mode: 'discrete' })
  return cachedRun
}

export function staticDeps(
  options: { withResults?: boolean; results?: SimulationOutput } = {}
): CommandDeps {
  return createStaticDeps(fixtureTopology(), {
    palette: NO_COLOR,
    validate: validateView,
    runner: () => fixtureRun(),
    results: options.results ?? (options.withResults ? fixtureRun() : undefined)
  })
}

/** Run lines in order; returns the plain output of the last one. */
export function runLines(session: TerminalSession, ...lines: string[]): string {
  let last = ''
  for (const line of lines) last = session.run(line).lines.join('\n')
  return last
}
