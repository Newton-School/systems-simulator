import { describe, expect, it } from 'vitest'
import {
  createAuthoringFunctionalRequirement,
  functionalRequirementReducer,
  type AuthoringFunctionalRequirement
} from './questionAuthoringRequirements'

const initial: AuthoringFunctionalRequirement[] = [
  { id: 'fr-a', text: 'Accept writes' },
  { id: 'fr-b', text: 'Serve reads' }
]

describe('functionalRequirementReducer', () => {
  it('adds and edits requirements while preserving stable IDs', () => {
    const added = functionalRequirementReducer(initial, {
      type: 'add',
      requirement: createAuthoringFunctionalRequirement('', 'fr-c')
    })
    const edited = functionalRequirementReducer(added, {
      type: 'update',
      id: 'fr-c',
      text: 'Replay failed deliveries'
    })

    expect(edited).toEqual([...initial, { id: 'fr-c', text: 'Replay failed deliveries' }])
  })

  it('moves requirements in both directions without changing their IDs', () => {
    const movedUp = functionalRequirementReducer(initial, {
      type: 'move',
      id: 'fr-b',
      direction: 'up'
    })
    const movedDown = functionalRequirementReducer(movedUp, {
      type: 'move',
      id: 'fr-b',
      direction: 'down'
    })

    expect(movedUp.map((requirement) => requirement.id)).toEqual(['fr-b', 'fr-a'])
    expect(movedDown).toEqual(initial)
  })

  it('removes a requirement and treats boundary moves as no-ops', () => {
    const boundaryMove = functionalRequirementReducer(initial, {
      type: 'move',
      id: 'fr-a',
      direction: 'up'
    })
    const removed = functionalRequirementReducer(boundaryMove, {
      type: 'remove',
      id: 'fr-a'
    })

    expect(boundaryMove).toEqual(initial)
    expect(removed).toEqual([{ id: 'fr-b', text: 'Serve reads' }])
  })

  it('does not admit duplicate stable IDs', () => {
    const duplicate = functionalRequirementReducer(initial, {
      type: 'add',
      requirement: { id: 'fr-a', text: 'Conflicting text' }
    })

    expect(duplicate).toEqual(initial)
  })
})
