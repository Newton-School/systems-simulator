import { describe, expect, it } from 'vitest'
import { buildHops } from './requestTraceHops'

const transition = (nodeId: string, state: string, timestampUs: number) => ({
  nodeId,
  state,
  timestampUs: String(timestampUs)
})

describe('buildHops stale marking', () => {
  it('marks a follower hop whose read may be stale, even if later states overwrite it', () => {
    const hops = buildHops({
      stateTimeline: [
        transition('api', 'forwarded', 1000),
        transition('replica', 'replica-read', 2000),
        transition('replica', 'stale-read-possible', 2100),
        transition('replica', 'completed', 3000)
      ]
    } as never)
    expect(hops.map((hop) => hop.nodeId)).toEqual(['api', 'replica'])
    expect(hops[0].maybeStale).toBeUndefined()
    expect(hops[1].maybeStale).toBe(true)
    expect(hops[1].state).toBe('completed')
  })

  it('marks a hop that starts with the stale state', () => {
    const hops = buildHops({
      stateTimeline: [transition('replica', 'stale-read-possible', 1000)]
    } as never)
    expect(hops[0].maybeStale).toBe(true)
  })
})
