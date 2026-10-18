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
})
