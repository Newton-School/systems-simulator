import { describe, expect, it } from 'vitest'
import {
  deriveNodeConcurrency,
  IO_WORKERS_PER_VCPU,
  effectivePerfFactor,
  serviceTimeMultiplier
} from '../resourceDerivation'
import type { ComponentNode } from '../../core/types'

function node(partial: Partial<ComponentNode>): ComponentNode {
  return {
    id: 'n',
    type: 'microservice',
    category: 'compute',
    label: 'n',
    position: { x: 0, y: 0 },
    queue: { workers: 8, capacity: 100, discipline: 'fifo' },
    ...partial
  }
}

describe('deriveNodeConcurrency', () => {
  it('passes raw queue values through when there is no instance model', () => {
    const d = deriveNodeConcurrency(node({}))
    expect(d.effectiveC).toBe(8)
    expect(d.effectiveK).toBe(100)
    expect(d.admissionBoundBy).toBe('backlog')
  })

  it('leaves legacy replicas-only resources decorative (no multiply, back-compat)', () => {
    const d = deriveNodeConcurrency(node({ resources: { cpu: 4, memory: 2048, replicas: 2 } }))
    expect(d.effectiveC).toBe(8) // unchanged from queue.workers — legacy resources decorative
  })

  describe('derived concurrency (workers are NOT authored)', () => {
    it('cpu-bound derives 1 worker per vCPU', () => {
      // c5.xlarge = 4 vCPU × 2 instances = 8 vCPU → 8 workers (cpu-bound)
      const d = deriveNodeConcurrency(
        node({
          resources: { instanceType: 'c5.xlarge', instanceCount: 2, workloadKind: 'cpu-bound' }
        })
      )
      expect(d.workersPerInstance).toBe(4) // 4 vCPU × 1
      expect(d.effectiveC).toBe(8) // 8 total vCPU
    })

    it('io-bound derives IO_WORKERS_PER_VCPU per vCPU', () => {
      // m5.large = 2 vCPU × 1 → 2 × 32 = 64 workers (io-bound)
      const d = deriveNodeConcurrency(
        node({ resources: { instanceType: 'm5.large', instanceCount: 1, workloadKind: 'io-bound' } })
      )
      expect(d.workersPerInstance).toBe(2 * IO_WORKERS_PER_VCPU)
      expect(d.effectiveC).toBe(2 * IO_WORKERS_PER_VCPU)
    })

    it('ignores any authored workersPerInstance (it is derived, not a dial)', () => {
      const d = deriveNodeConcurrency(
        node({
          resources: {
            instanceType: 'm5.large',
            instanceCount: 1,
            workloadKind: 'cpu-bound',
            workersPerInstance: 999999 // ignored
          }
        })
      )
      expect(d.effectiveC).toBe(2) // 2 vCPU cpu-bound, NOT 999999
    })

    it('scales concurrency by instance count', () => {
      const one = deriveNodeConcurrency(
        node({ resources: { instanceType: 'c5.large', instanceCount: 1, workloadKind: 'cpu-bound' } })
      )
      const three = deriveNodeConcurrency(
        node({ resources: { instanceType: 'c5.large', instanceCount: 3, workloadKind: 'cpu-bound' } })
      )
      expect(three.effectiveC).toBe(one.effectiveC * 3)
    })
  })

  describe('derived admission K (from RAM)', () => {
    it('K is the RAM ceiling and is RAM-bound', () => {
      // t3.small = 2 GB = 2048 MB; perRequestMemMb 100 → memCeiling = 20
      const d = deriveNodeConcurrency(
        node({
          resources: {
            instanceType: 't3.small',
            instanceCount: 1,
            workloadKind: 'cpu-bound',
            perRequestMemMb: 100
          }
        })
      )
      expect(d.effectiveK).toBe(20)
      expect(d.admissionBoundBy).toBe('ram')
    })

  })

  describe('compute-perf factor', () => {
    it('cpu-bound gets the full instance perfFactor', () => {
      expect(effectivePerfFactor(1.3, 'cpu-bound')).toBeCloseTo(1.3) // c5
      expect(effectivePerfFactor(0.8, 'cpu-bound')).toBeCloseTo(0.8) // t3
    })

    it('io-bound is damped toward 1.0 (a faster core barely helps a waiter)', () => {
      // 1 + (1.3 - 1) × 0.25 = 1.075
      expect(effectivePerfFactor(1.3, 'io-bound')).toBeCloseTo(1.075)
      expect(effectivePerfFactor(0.8, 'io-bound')).toBeCloseTo(0.95)
    })

    it('serviceTimeMultiplier: a faster cpu-bound c5 lowers service time', () => {
      const d = serviceTimeMultiplier(
        node({ resources: { instanceType: 'c5.large', workloadKind: 'cpu-bound' } })
      )
      expect(d).toBeCloseTo(1 / 1.3) // ~0.77 → 23% faster
    })

    it('serviceTimeMultiplier: a slower cpu-bound t3 raises service time', () => {
      const d = serviceTimeMultiplier(
        node({ resources: { instanceType: 't3.small', workloadKind: 'cpu-bound' } })
      )
      expect(d).toBeCloseTo(1 / 0.8) // 1.25 → 25% slower
    })

    it('serviceTimeMultiplier: legacy (no instance model) is unaffected', () => {
      expect(serviceTimeMultiplier(node({}))).toBe(1)
    })
  })

  describe('derived admission K continued', () => {
    it('never lets K fall below effective concurrency', () => {
      // Tiny RAM per huge request would give memCeiling < c; K clamps to c.
      const d = deriveNodeConcurrency(
        node({
          resources: {
            instanceType: 'c5.2xlarge', // 8 vCPU → 8 workers cpu-bound
            instanceCount: 1,
            workloadKind: 'cpu-bound',
            perRequestMemMb: 100000 // memCeiling ≈ 0
          }
        })
      )
      expect(d.effectiveC).toBe(8)
      expect(d.effectiveK).toBe(8) // max(8, 0)
    })
  })
})
