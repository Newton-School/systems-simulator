import { describe, expect, it } from 'vitest'
import { DEFAULT_QUESTION_AUTHORING_SETUP } from '../analysis/questionAuthoringProject'
import { applyAdaptiveAuthoringRecipe } from './adaptiveAuthoring'

describe('adaptive system-design question authoring', () => {
  it('turns a Classroom-ready concept into the smallest objective-backed starter', () => {
    const result = applyAdaptiveAuthoringRecipe(DEFAULT_QUESTION_AUTHORING_SETUP, 'NET-05')

    expect(result.applied).toBe(true)
    expect(result.setup.concepts).toEqual(['NET-05'])
    expect(result.setup.constraints.allowedNodeTypes).toEqual([
      'api-endpoint',
      'load-balancer',
      'microservice'
    ])
    expect(result.setup.classroom).toMatchObject({
      abstractions: ['classroom', 'guided', 'architect'],
      objectives: [
        {
          id: 'objective-net-05',
          concept: 'NET-05',
          statement: 'The student can apply load balancing to a visible system-design decision.'
        }
      ],
      checks: [
        {
          template: 'traffic-flows-through',
          objectiveId: 'objective-net-05',
          via: 'load-balancer'
        }
      ]
    })
    expect(result.setup.classroom?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'place-component', component: 'api-endpoint' }),
        expect.objectContaining({ kind: 'place-component', component: 'load-balancer' }),
        expect.objectContaining({ kind: 'place-component', component: 'microservice' }),
        expect.objectContaining({ kind: 'connect-components' })
      ])
    )
  })

  it('lets students build a blank-canvas sizing lesson, not only change copy counts', () => {
    const result = applyAdaptiveAuthoringRecipe(DEFAULT_QUESTION_AUTHORING_SETUP, 'CMP-02')
    expect(result.applied).toBe(true)
    expect(result.setup.type).toBe('scaling')
    expect(result.setup.classroom?.controls?.map((control) => control.kind)).toEqual([
      'place-component',
      'place-component',
      'place-component',
      'connect-components',
      'copies'
    ])
    expect(result.setup.classroom?.controls?.at(-1)).toMatchObject({ component: 'microservice' })
    expect(result.setup.classroom?.checks).toEqual([
      expect.objectContaining({ template: 'serves-all-traffic', objectiveId: 'objective-cmp-02' })
    ])
  })

  it('does not repeat decisions when a lesson combines two concepts', () => {
    const withLoadBalancing = applyAdaptiveAuthoringRecipe(
      DEFAULT_QUESTION_AUTHORING_SETUP,
      'NET-05'
    ).setup
    const combined = applyAdaptiveAuthoringRecipe(withLoadBalancing, 'CMP-02').setup
    const controls = combined.classroom?.controls ?? []
    expect(controls.map((control) => `${control.objectiveId}:${control.kind}`)).toEqual([
      'objective-net-05:place-component',
      'objective-net-05:place-component',
      'objective-net-05:place-component',
      'objective-net-05:connect-components',
      'objective-cmp-02:copies'
    ])
  })

  it('does not invent capacity givens', () => {
    const result = applyAdaptiveAuthoringRecipe(DEFAULT_QUESTION_AUTHORING_SETUP, 'SC-05')
    expect(result.applied).toBe(true)
    expect(result.setup.classroom?.givens).toBeUndefined()
    expect(result.setup.classroom?.targets?.maxUtilization).toBe(0.8)
  })

  it('routes unsupported concepts without manufacturing Classroom controls or checks', () => {
    const result = applyAdaptiveAuthoringRecipe(DEFAULT_QUESTION_AUTHORING_SETUP, 'COORD-06')
    expect(result.applied).toBe(false)
    expect(result.setup.concepts).toEqual(['COORD-06'])
    expect(result.setup.classroom).toBeUndefined()
    expect(result.reason).toMatch(/Architect mode/)
  })

  it('preserves author-entered controls and checks when reapplying a recipe', () => {
    const first = applyAdaptiveAuthoringRecipe(DEFAULT_QUESTION_AUTHORING_SETUP, 'NET-05').setup
    const second = applyAdaptiveAuthoringRecipe(first, 'NET-05').setup
    expect(second.classroom?.objectives).toHaveLength(1)
    expect(second.classroom?.controls).toHaveLength(4)
    expect(second.classroom?.checks).toHaveLength(1)
  })
})
