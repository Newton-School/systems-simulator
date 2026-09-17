import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { SAMPLE_SCENARIOS } from '../../config/sampleScenarios'
import { matchesScenarioSearch } from './scenarioSearch'

interface SidebarScenario {
  id: string
  title: string
  description: string
  badge: string
  subtitle: string
  diagram: string
  focusLabel: string
  focusText: string
}

function ScenarioCard({
  scenario,
  isExpanded,
  onToggle,
  onLoadScenario
}: {
  scenario: SidebarScenario
  isExpanded: boolean
  onToggle: () => void
  onLoadScenario: (scenarioId: string) => Promise<void>
}): React.JSX.Element {
  return (
    <div
      className={[
        'rounded-lg border transition-colors',
        isExpanded
          ? 'border-nss-primary bg-nss-surface'
          : 'border-nss-border bg-nss-panel hover:border-nss-primary/50'
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full p-3 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-nss-text">{scenario.title}</h4>
          <span className="shrink-0 rounded border border-nss-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-muted">
            {scenario.badge}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">{scenario.description}</p>
      </button>

      {isExpanded ? (
        <div className="space-y-2 px-3 pb-3">
          <div className="rounded-md border border-nss-border bg-nss-panel px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              {scenario.subtitle}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-nss-text">
              {scenario.diagram}
            </p>
          </div>

          <div className="rounded-md border border-nss-primary/20 bg-nss-primary/10 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-primary">
              {scenario.focusLabel}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-nss-text">{scenario.focusText}</p>
          </div>

          <button
            type="button"
            onClick={() => void onLoadScenario(scenario.id)}
            className="w-full rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90"
          >
            Load Scenario
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function ScenarioSidebarPanel({
  onLoadScenario
}: {
  onLoadScenario: (scenarioId: string) => Promise<void>
}): React.JSX.Element {
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const scenarios = useMemo<SidebarScenario[]>(
    () =>
      SAMPLE_SCENARIOS.map((scenario) => ({
        id: `sample:${scenario.id}`,
        title: scenario.name,
        description: scenario.primaryUseCase,
        badge: scenario.difficulty,
        subtitle: scenario.subtitle,
        diagram: scenario.diagram,
        focusLabel: 'Why Run It',
        focusText: scenario.simulatorValue
      })),
    []
  )
  const filteredScenarios = useMemo(
    () => scenarios.filter((scenario) => matchesScenarioSearch(scenario, searchQuery)),
    [scenarios, searchQuery]
  )

  return (
    <>
      <div className="shrink-0 space-y-1 border-b border-nss-border p-4 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">Scenarios</h2>
        <p className="text-[11px] leading-relaxed text-nss-muted">
          Pre-built systems you can load onto the canvas. Click one to see what it demonstrates,
          then load it and press play.
        </p>
        <label className="relative mt-3 block">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nss-muted"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search scenarios"
            aria-label="Search pre-made scenarios"
            autoComplete="off"
            className="nss-search-input h-10 w-full rounded-md border border-nss-border bg-nss-input-bg py-2 pl-9 pr-9 text-[12px] text-nss-text placeholder-nss-placeholder outline-none transition-colors focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear scenario search"
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-nss-muted hover:bg-nss-text/5 hover:text-nss-text"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
        {searchQuery.trim() ? (
          <p className="pt-1 text-[10px] text-nss-muted" aria-live="polite">
            {filteredScenarios.length} of {scenarios.length} scenarios
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {filteredScenarios.length > 0 ? (
          filteredScenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              isExpanded={selectedScenarioId === scenario.id}
              onToggle={() =>
                setSelectedScenarioId(selectedScenarioId === scenario.id ? '' : scenario.id)
              }
              onLoadScenario={onLoadScenario}
            />
          ))
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center px-3 text-center">
            <Search size={20} className="mb-2 text-nss-muted" aria-hidden="true" />
            <p className="text-[12px] font-medium text-nss-text">No scenarios found</p>
            <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
              Try a pattern, component, difficulty, or concept such as cache, latency, or sharding.
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-3 rounded-md px-3 py-2 text-[11px] font-semibold text-nss-primary hover:bg-nss-primary/10"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </>
  )
}
