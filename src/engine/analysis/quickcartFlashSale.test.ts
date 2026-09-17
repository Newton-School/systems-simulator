import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import { gradeAttempt, parseQuestionPackage } from './question'
import { runSimulation } from '../runSimulation'

const question = parseQuestionPackage(
  JSON.parse(
    readFileSync(resolve(__dirname, 'fixtures/quickcart-flash-sale.question.json'), 'utf-8')
  )
)

function server(id: string): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    // "Each backend server can handle a maximum of 100,000 requests per second."
    config: { capacityRps: 100_000 }
  }
}

function edge(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 100_000,
    maxConcurrentRequests: 2_000_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

/** A student submission: Users → LB → `serverCount` servers. */
function submission(serverCount: number): TopologyJSON {
  const servers = Array.from({ length: serverCount }, (_, i) => server(`srv-${i}`))
  return {
    id: 'student',
    name: 'Student QuickCart',
    version: '1',
    global: {
      simulationDuration: 5000,
      seed: 'seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30000
    },
    nodes: [
      {
        id: 'users',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'Users',
        position: { x: 0, y: 0 }
      },
      {
        id: 'lb',
        type: 'load-balancer',
        category: 'network',
        role: 'router',
        label: 'Load Balancer',
        position: { x: 0, y: 0 }
      },
      ...servers
    ],
    edges: [edge('users', 'lb'), ...servers.map((s) => edge('lb', s.id))],
    workload: {
      sourceNodeId: 'users',
      pattern: 'constant',
      baseRps: 1_000_000,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  }
}

describe('QuickCart flash-sale question', () => {
  it('parses as a valid question package', () => {
    expect(question.id).toBe('quickcart-flash-sale')
    expect(question.type).toBe('scaling')
  })

  it('passes with 13 servers (1M / 13·100k = 76.9% ≤ 80%)', () => {
    const grade = gradeAttempt(question, submission(13), runSimulation)
    expect(grade.contract.allPassed).toBe(true)
  })

  it('fails with 12 servers (83.3% > 80% headroom)', () => {
    const grade = gradeAttempt(question, submission(12), runSimulation)
    expect(grade.contract.allPassed).toBe(false)
    // The headroom invariant is the check that trips.
    const headroom = grade.graded.cases
      .flatMap((c) => c.rubric?.checks ?? [])
      .find((check) => check.id === 'within-headroom')
    expect(headroom?.passed).toBe(false)
  })

  it('fails with 8 servers (drops requests) on both drop and headroom checks', () => {
    const grade = gradeAttempt(question, submission(8), runSimulation)
    expect(grade.contract.allPassed).toBe(false)
    const checks = grade.graded.cases.flatMap((c) => c.rubric?.checks ?? [])
    expect(checks.find((c) => c.id === 'no-dropped-requests')?.passed).toBe(false)
    expect(checks.find((c) => c.id === 'within-headroom')?.passed).toBe(false)
  })

  it('grades the 1M-rps run analytically (fast, no event blow-up)', () => {
    const start = Date.now()
    gradeAttempt(question, submission(13), runSimulation)
    expect(Date.now() - start).toBeLessThan(2000)
  })
})
