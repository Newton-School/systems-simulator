export interface SearchableScenario {
  title: string
  description: string
  badge: string
  subtitle: string
  diagram: string
  focusLabel: string
  focusText: string
}

export function matchesScenarioSearch(scenario: SearchableScenario, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const haystack = [
    scenario.title,
    scenario.description,
    scenario.badge,
    scenario.subtitle,
    scenario.diagram,
    scenario.focusLabel,
    scenario.focusText
  ]
    .join(' ')
    .toLocaleLowerCase()

  return terms.every((term) => haystack.includes(term))
}
