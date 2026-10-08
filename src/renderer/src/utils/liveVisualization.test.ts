import { describe, expect, it } from 'vitest'
import type { TimeSeriesSnapshot } from '../../../engine/analysis/output'
import { computeLiveVisualization, LIVE_UTILIZATION_COLORS } from './liveVisualization'
import { appendBounded } from '../hooks/useSimulation'

type NodeEntry = TimeSeriesSnapshot['node'][string]

function node(partial: Partial<NodeEntry>): NodeEntry {
  return {
    queueLength: 0,
    activeWorkers: 0,
    totalInSystem: 0,
    utilization: 0,
    status: 'busy',
    workers: 4,
    capacity: 20,
    ...partial
  }
}

/** Cumulative integrals for a node held at `util` (4 workers) for `ms`. */
function steady(util: number, ms: number, rps: number, extra: Partial<NodeEntry> = {}): NodeEntry {
  return node({
    busyAreaUs: util * 4 * ms * 1000,
    capacityAreaUs: 4 * ms * 1000,
    completedTotal: (rps * ms) / 1000,
    ...extra
  })
}

describe('computeLiveVisualization', () => {
  it('returns empty maps when no snapshots exist', () => {
    const live = computeLiveVisualization([])
    expect(live.nodeStyles.size).toBe(0)
    expect(live.edgeStyles.size).toBe(0)
  })

  it('maps time-weighted utilization to the issue colour bands', () => {
    const live = computeLiveVisualization([
      {
        timestamp: 2_000,
        node: {
          half: steady(0.5, 2_000, 100),
          ninety: steady(0.9, 2_000, 100),
          seventy: steady(0.7, 2_000, 100),
          full: steady(0.97, 2_000, 100)
        }
      }
    ])
    expect(
      live.nodeStyles.get('half')?.backgroundColor.startsWith(LIVE_UTILIZATION_COLORS.green)
    ).toBe(true)
    expect(live.nodeStyles.get('seventy')?.color).toBe(LIVE_UTILIZATION_COLORS.yellow)
    expect(live.nodeStyles.get('ninety')?.color).toBe(LIVE_UTILIZATION_COLORS.orange)
    expect(live.nodeStyles.get('full')?.color).toBe(LIVE_UTILIZATION_COLORS.red)
  })

  it('a failed node is red with the failed icon', () => {
    const live = computeLiveVisualization([
      { timestamp: 1_000, node: { db: steady(0.1, 1_000, 5, { status: 'failed' }) } }
    ])
    const style = live.nodeStyles.get('db')!
    expect(style.color).toBe(LIVE_UTILIZATION_COLORS.red)
    expect(style.statusIcon).toBe('failed')
  })

  it('uses the windowed integral, never the instantaneous point sample', () => {
    // Busy 20% for the first 5s, then 100% for 1s: the instantaneous sample says
    // 0 (a worker just went idle) but the window really was busy.
    const first = steady(0.2, 5_000, 50, { utilization: 1 })
    const secondBusy = (first.busyAreaUs ?? 0) + 1.0 * 4 * 1_000 * 1000
    const second = node({
      utilization: 0,
      busyAreaUs: secondBusy,
      capacityAreaUs: (first.capacityAreaUs ?? 0) + 4 * 1_000 * 1000,
      completedTotal: (first.completedTotal ?? 0) + 400
    })
    const live = computeLiveVisualization(
      [
        { timestamp: 5_000, node: { api: first } },
        { timestamp: 6_000, node: { api: second } }
      ],
      {},
      1_000
    )
    const style = live.nodeStyles.get('api')!
    expect(style.utilization).toBeCloseTo(1, 6)
    expect(style.throughputRps).toBeCloseTo(400, 6)
    expect(style.windowMs).toBe(1_000)
    expect(style.overlayText).toBe('400 rps | 100% busy')
  })

  it('shows current queue fill against the waiting room', () => {
    const live = computeLiveVisualization([
      { timestamp: 1_000, node: { api: steady(0.95, 1_000, 10, { queueLength: 8 }) } }
    ])
    // capacity 20 - workers 4 = 16 waiting slots; 8 queued = 50%.
    expect(live.nodeStyles.get('api')?.queueFillPercent).toBe(50)
  })

  it('scales edge width with throughput and colours by latency vs expectation', () => {
    const live = computeLiveVisualization([{ timestamp: 1_000, node: {} }], {
      busy: { throughputRps: 100, recentLatenciesMs: [1, 1, 1], expectedLatencyMs: 1 },
      quiet: { throughputRps: 10, recentLatenciesMs: [8, 8], expectedLatencyMs: 2 },
      idle: { throughputRps: 0, recentLatenciesMs: [] }
    })
    expect(live.edgeStyles.get('busy')?.strokeWidth).toBe(6)
    expect(live.edgeStyles.get('quiet')?.strokeWidth).toBe(1)
    expect(live.edgeStyles.get('busy')?.strokeColor).toBe(LIVE_UTILIZATION_COLORS.green)
    expect(live.edgeStyles.get('quiet')?.strokeColor).toBe(LIVE_UTILIZATION_COLORS.red)
    expect(live.edgeStyles.get('busy')?.labelText).toBe('1.0ms')
    expect(live.edgeStyles.get('idle')?.animated).toBe(false)
    expect(live.edgeStyles.get('idle')?.strokeColor).toBeNull()
  })
})

describe('appendBounded (snapshot history cap)', () => {
  it('drops the oldest entries past the cap', () => {
    let history: number[] = []
    for (let i = 0; i < 10; i++) history = appendBounded(history, i, 4)
    expect(history).toEqual([6, 7, 8, 9])
  })
})
