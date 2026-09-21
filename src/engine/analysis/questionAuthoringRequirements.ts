export interface AuthoringFunctionalRequirement {
  id: string
  text: string
}

export type FunctionalRequirementAction =
  | { type: 'add'; requirement: AuthoringFunctionalRequirement }
  | { type: 'update'; id: string; text: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; direction: 'up' | 'down' }

function createRequirementId(): string {
  const uniquePart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `fr-${uniquePart}`
}

export function createAuthoringFunctionalRequirement(
  text = '',
  id = createRequirementId()
): AuthoringFunctionalRequirement {
  return { id, text }
}

export function functionalRequirementReducer(
  requirements: readonly AuthoringFunctionalRequirement[],
  action: FunctionalRequirementAction
): AuthoringFunctionalRequirement[] {
  switch (action.type) {
    case 'add':
      return requirements.some((requirement) => requirement.id === action.requirement.id)
        ? [...requirements]
        : [...requirements, action.requirement]
    case 'update':
      return requirements.map((requirement) =>
        requirement.id === action.id ? { ...requirement, text: action.text } : requirement
      )
    case 'remove':
      return requirements.filter((requirement) => requirement.id !== action.id)
    case 'move': {
      const currentIndex = requirements.findIndex((requirement) => requirement.id === action.id)
      if (currentIndex < 0) return [...requirements]
      const nextIndex = action.direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (nextIndex < 0 || nextIndex >= requirements.length) return [...requirements]

      const reordered = [...requirements]
      ;[reordered[currentIndex], reordered[nextIndex]] = [
        reordered[nextIndex],
        reordered[currentIndex]
      ]
      return reordered
    }
  }
}
