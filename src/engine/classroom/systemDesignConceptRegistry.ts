import { SYSTEM_DESIGN_CONCEPTS } from './systemDesignConceptRegistry.generated'

export type SystemDesignTeachingSurface = 'C' | 'G' | 'A' | 'X'
export type SystemDesignConcept = (typeof SYSTEM_DESIGN_CONCEPTS)[number]
export type SystemDesignConceptId = SystemDesignConcept['id']
export type SystemDesignAuthoringRecipe = SystemDesignConcept['authoring']
export type SystemDesignAuthoringOutcome = SystemDesignAuthoringRecipe['outcome']

const CONCEPT_BY_ID = new Map<string, SystemDesignConcept>(
  SYSTEM_DESIGN_CONCEPTS.map((concept) => [concept.id, concept])
)

export function getSystemDesignConcept(id: string): SystemDesignConcept | undefined {
  return CONCEPT_BY_ID.get(id.trim().toUpperCase())
}

export function systemDesignConceptSupports(
  concept: SystemDesignConcept,
  surface: SystemDesignTeachingSurface
): boolean {
  return (concept.surfaces as readonly string[]).includes(surface)
}

export function getSystemDesignAuthoringRecipe(
  id: string
): SystemDesignAuthoringRecipe | undefined {
  return getSystemDesignConcept(id)?.authoring
}

export function systemDesignConceptSupportsClassroomAuthoring(
  concept: SystemDesignConcept
): boolean {
  return (
    concept.authoring.outcome === 'classroom-direct' ||
    concept.authoring.outcome === 'classroom-structural'
  )
}

export interface ResolvedSystemDesignConcepts {
  concepts: SystemDesignConcept[]
  unknownIds: string[]
}

export function resolveSystemDesignConcepts(ids: readonly string[]): ResolvedSystemDesignConcepts {
  const concepts: SystemDesignConcept[] = []
  const unknownIds: string[] = []
  const seen = new Set<string>()
  for (const rawId of ids) {
    const id = rawId.trim().toUpperCase()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const concept = getSystemDesignConcept(id)
    if (concept) concepts.push(concept)
    else unknownIds.push(rawId)
  }
  return { concepts, unknownIds }
}

export function systemDesignConceptsByDomain(): Map<string, SystemDesignConcept[]> {
  const grouped = new Map<string, SystemDesignConcept[]>()
  for (const concept of SYSTEM_DESIGN_CONCEPTS) {
    const existing = grouped.get(concept.domainId) ?? []
    existing.push(concept)
    grouped.set(concept.domainId, existing)
  }
  return grouped
}

export { SYSTEM_DESIGN_CONCEPTS }
