import { describe, expect, it } from 'vitest'
import type { ComponentType, TopologyJSON } from '../core/types'
import type { JustifyPrompt } from './gradingCriteria'
import {
  buildJustificationContext,
  extractNumbers,
  gradeJustification,
  gradeJustifications,
  type JustificationContext
} from './justification'

describe('buildJustificationContext', () => {
  const topology = {
    nodes: [
      { id: 'store-1', type: 'kv-store', label: 'Cassandra' },
      { id: 'svc-1', type: 'microservice', label: 'API' }
    ],
    edges: []
  } as unknown as TopologyJSON

  it('resolves a bound type only when a node of that type exists', () => {
    const ctx = buildJustificationContext(topology, [200000])
    expect(ctx.resolveBoundType({ componentType: 'kv-store' as ComponentType })).toBe('kv-store')
    expect(
      ctx.resolveBoundType({ componentType: 'relational-db' as ComponentType })
    ).toBeUndefined()
    expect(ctx.resolveBoundType({ nodeId: 'svc-1' })).toBe('microservice')
  })

  it('derives aliases from the type token and the node label', () => {
    const ctx = buildJustificationContext(topology, [])
    const aliases = ctx.aliasesOf('kv-store' as ComponentType)
    expect(aliases).toEqual(
      expect.arrayContaining(['kv-store', 'kv store', 'kv', 'store', 'cassandra'])
    )
  })

  it('carries the injected scale numbers through', () => {
    expect(buildJustificationContext(topology, [200000, 99]).scaleNumbers).toEqual([200000, 99])
  })
})

const prompt: JustifyPrompt = {
  id: 'why-db',
  decision: 'Why this database type for the write path?',
  boundTo: { componentType: 'wide-column-db' as ComponentType },
  requires: { choice: true, number: true, tradeoff: true }
}

// A graph that actually contains a wide-column store; SQL is NOT present.
function ctx(overrides: Partial<JustificationContext> = {}): JustificationContext {
  return {
    resolveBoundType: () => 'wide-column-db' as ComponentType,
    aliasesOf: (type) =>
      type === ('wide-column-db' as ComponentType) ? ['wide-column', 'cassandra'] : [],
    scaleNumbers: [200000, 0.1],
    ...overrides
  }
}

describe('gradeJustification — graph-consistency gate', () => {
  it('passes a graph-consistent answer that cites a number and a tradeoff', () => {
    const res = gradeJustification(
      prompt,
      {
        promptId: 'why-db',
        text: 'Cassandra (wide-column) handles 200K writes/sec, but we lose ad-hoc joins.'
      },
      ctx()
    )
    expect(res.outcome).toBe('passed')
    expect(res.checks).toEqual({
      graphConsistent: true,
      substance: true,
      number: true,
      tradeoff: true
    })
  })

  it('fails a keyword-stuffed answer that names the WRONG store (not in the graph)', () => {
    // Student wrote a plausible-sounding SQL justification, but the graph has wide-column.
    const res = gradeJustification(
      prompt,
      { promptId: 'why-db', text: 'I used a SQL database for 200K writes/sec, but lose scale.' },
      ctx()
    )
    expect(res.outcome).toBe('failed')
    expect(res.checks.graphConsistent).toBe(false)
    expect(res.pointsEarned).toBe(0)
  })

  it('fails when the bound component is absent from the graph', () => {
    const res = gradeJustification(
      prompt,
      { promptId: 'why-db', text: 'Cassandra, 200K, but...' },
      ctx({ resolveBoundType: () => undefined })
    )
    expect(res.outcome).toBe('failed')
    expect(res.detail).toMatch(/does not contain/i)
  })

  it('treats an empty answer or a prompt-echo as missing', () => {
    expect(gradeJustification(prompt, { promptId: 'why-db', text: '   ' }, ctx()).outcome).toBe(
      'missing'
    )
    expect(
      gradeJustification(
        prompt,
        { promptId: 'why-db', text: 'Why this database type for the write path?' },
        ctx()
      ).outcome
    ).toBe('missing')
  })

  it('is partial when the choice is consistent but a number is missing', () => {
    const res = gradeJustification(
      prompt,
      { promptId: 'why-db', text: 'Cassandra wide-column, but we lose joins.' },
      ctx()
    )
    expect(res.outcome).toBe('partial')
    expect(res.checks).toEqual({
      graphConsistent: true,
      substance: true,
      number: false,
      tradeoff: true
    })
  })
})

describe('extractNumbers', () => {
  it('expands k/m/b suffixes and matches tolerantly', () => {
    expect(extractNumbers('200K writes and 1.25M pings')).toEqual([200000, 1250000])
    expect(extractNumbers('under 5ms and 50 nodes')).toEqual([5, 50])
  })
})

describe('gradeJustifications — point allocation', () => {
  it('allocates full, proportional-partial, and zero across prompts', () => {
    const prompts: JustifyPrompt[] = [
      prompt, // requires choice+number+tradeoff
      {
        id: 'why-cache',
        decision: 'Why a cache?',
        boundTo: { componentType: 'cache' as ComponentType },
        requires: { choice: true, tradeoff: true }
      }
    ]
    const c = ctx({
      resolveBoundType: (b) =>
        (b?.componentType === ('cache' as ComponentType)
          ? 'cache'
          : 'wide-column-db') as ComponentType,
      aliasesOf: (t) =>
        t === ('cache' as ComponentType) ? ['cache', 'redis'] : ['wide-column', 'cassandra']
    })
    const batch = gradeJustifications(
      prompts,
      [
        { promptId: 'why-db', text: 'Cassandra, but we lose joins.' }, // partial: no number (1 of 2 graded)
        { promptId: 'why-cache', text: 'Redis cache, but staleness.' } // passed
      ],
      c,
      { 'why-db': 40, 'why-cache': 20 }
    )
    expect(batch.pointsPossible).toBe(60)
    // why-db: partial, graded checks = [substance:true, number:false, tradeoff:true] -> floor(40 * 2/3) = 26
    // why-cache: passed → 20
    expect(batch.pointsEarned).toBe(46)
    expect(batch.results[0].outcome).toBe('partial')
    expect(batch.results[1].outcome).toBe('passed')
  })
})
