import { describe, expect, it } from 'vitest'
import {
  parseReplicaMemberIds,
  serializeReplicaMemberIds,
  toggleReplicaMember
} from './replicaMembers'

describe('replica member selection', () => {
  it('parses legacy comma-separated membership without duplicates', () => {
    expect(parseReplicaMemberIds(' primary, replica-a,replica-a, replica-b ')).toEqual([
      'primary',
      'replica-a',
      'replica-b'
    ])
  })

  it('serializes selected node IDs in the supplied order', () => {
    expect(serializeReplicaMemberIds(['primary', 'replica-a', 'replica-a'])).toBe(
      'primary,replica-a'
    )
    expect(serializeReplicaMemberIds([])).toBeUndefined()
  })

  it('always retains the database currently being configured', () => {
    expect(toggleReplicaMember(['primary', 'replica-a'], 'primary', false, 'primary')).toEqual([
      'primary',
      'replica-a'
    ])
    expect(toggleReplicaMember(['replica-a'], 'replica-b', true, 'primary')).toEqual([
      'replica-a',
      'replica-b',
      'primary'
    ])
  })
})
