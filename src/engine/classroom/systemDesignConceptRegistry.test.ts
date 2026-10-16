import { describe, expect, it } from 'vitest'
import {
  SYSTEM_DESIGN_CONCEPTS,
  getSystemDesignConcept,
  getSystemDesignAuthoringRecipe,
  resolveSystemDesignConcepts,
  systemDesignConceptSupports,
  systemDesignConceptSupportsClassroomAuthoring
} from './systemDesignConceptRegistry'

describe('system-design concept registry', () => {
  it('contains every stable concept extracted from the curriculum taxonomy', () => {
    expect(SYSTEM_DESIGN_CONCEPTS).toHaveLength(372)
    expect(new Set(SYSTEM_DESIGN_CONCEPTS.map((concept) => concept.id)).size).toBe(372)
  })

  it('resolves identifiers case-insensitively and retains teaching surfaces', () => {
    const concept = getSystemDesignConcept('net-05')
    expect(concept).toMatchObject({
      id: 'NET-05',
      domain: 'Networking, naming, and edge delivery',
      title: 'Load balancing'
    })
    expect(concept && systemDesignConceptSupports(concept, 'C')).toBe(true)
    expect(resolveSystemDesignConcepts(['NET-05', 'missing'])).toMatchObject({
      concepts: [{ id: 'NET-05' }],
      unknownIds: ['missing']
    })
  })

  it('gives every curriculum concept a complete adaptive authoring recipe', () => {
    for (const concept of SYSTEM_DESIGN_CONCEPTS) {
      expect(concept.authoring.objectiveStem.length).toBeGreaterThan(0)
      expect(concept.authoring.boundary.length).toBeGreaterThan(0)
      expect(concept.authoring.activity.length).toBeGreaterThan(0)
      expect(getSystemDesignAuthoringRecipe(concept.id)).toBe(concept.authoring)
    }
  })

  it('routes concepts through honest evidence instead of assuming every concept is Classroom-ready', () => {
    const loadBalancing = getSystemDesignConcept('NET-05')!
    expect(systemDesignConceptSupportsClassroomAuthoring(loadBalancing)).toBe(true)
    expect(loadBalancing.authoring).toMatchObject({
      outcome: 'classroom-structural',
      activity: 'place',
      recommendedCards: ['users', 'load-balancer', 'server'],
      compatibleChecks: ['traffic-flows-through']
    })

    const consensus = getSystemDesignConcept('COORD-06')!
    expect(systemDesignConceptSupportsClassroomAuthoring(consensus)).toBe(false)
    expect(consensus.authoring.outcome).toBe('architect-handoff')
    expect(consensus.authoring.compatibleChecks).toEqual([])
  })
})
