import { describe, expect, it } from 'vitest'
import type { QuestionPackage } from '../analysis/question'
import { classroomReadiness } from './readiness'

function question(overrides: Partial<QuestionPackage> = {}): QuestionPackage {
  return {
    version: '1',
    id: 'readiness',
    title: 'Readiness',
    description: 'Readiness fixture',
    difficulty: 'beginner',
    type: 'scaling',
    entryFormat: 'blank-canvas',
    prompt: {
      text: 'Handle peak traffic.',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: { peakRps: 1000 }
    },
    scaffold: { type: 'empty' },
    constraints: {
      allowedNodeTypes: ['api-endpoint', 'microservice'],
      canModifyScaffold: true,
      canRemoveScaffoldNodes: true
    },
    classroom: { givens: { microservice: { capacityRps: 1000 } } },
    suite: { name: 'readiness', visibleToStudent: false, cases: [] },
    rubric: { version: '1', id: 'readiness', passThreshold: 1, checks: [] },
    ...overrides
  }
}

describe('Classroom question readiness', () => {
  it('accepts a question whose visible components and givens are complete', () => {
    expect(classroomReadiness(question())).toEqual({ ready: true })
  })

  it('fails closed when the question has no explicit component kit', () => {
    const fixture = question()
    fixture.constraints = { ...fixture.constraints, allowedNodeTypes: undefined }
    expect(classroomReadiness(fixture)).toEqual({
      ready: false,
      reason: "The question doesn't declare which Classroom components students may use."
    })
  })

  it('fails closed when any allowed component lacks a concept card', () => {
    const fixture = question()
    fixture.constraints = {
      ...fixture.constraints,
      allowedNodeTypes: ['api-endpoint', 'vector-db']
    }
    expect(classroomReadiness(fixture)).toEqual({
      ready: false,
      reason: "The allowed component 'vector-db' has no Classroom concept card."
    })
  })

  it('fails closed when caching can be turned on without a stated hit rate', () => {
    const cacheChoice = {
      id: 'caching',
      label: 'Caching',
      explanation: 'Serve repeat reads from memory.',
      objectiveId: 'cache',
      target: 'cache-enabled' as const,
      options: [
        { id: 'on', label: 'On', explanation: 'Cache reads.', value: 'on' },
        { id: 'off', label: 'Off', explanation: 'Read every time.', value: 'off' }
      ]
    }
    const unstated = question({
      classroom: {
        givens: { microservice: { capacityRps: 1000 } },
        choices: { microservice: [cacheChoice] }
      }
    })
    expect(classroomReadiness(unstated)).toEqual({
      ready: false,
      reason: expect.stringContaining("doesn't state")
    })
    expect(classroomReadiness(unstated)).toMatchObject({
      reason: expect.stringContaining('hit rate')
    })

    const stated = question({
      classroom: {
        givens: { microservice: { capacityRps: 1000, cacheHitRate: 0.9 } },
        choices: { microservice: [cacheChoice] }
      }
    })
    expect(classroomReadiness(stated)).toEqual({ ready: true })
  })
})
