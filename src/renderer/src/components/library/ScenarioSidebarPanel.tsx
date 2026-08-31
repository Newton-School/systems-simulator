import { useMemo, useState } from 'react'
import { SAMPLE_SCENARIOS } from '../../config/sampleScenarios'

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

  return (
    <>
      <div className="shrink-0 space-y-1 border-b border-nss-border p-4 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">Scenarios</h2>
        <p className="text-[11px] leading-relaxed text-nss-muted">
          Pre-built systems you can load onto the canvas. Click one to see what it demonstrates,
          then load it and press play.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            isExpanded={selectedScenarioId === scenario.id}
            onToggle={() =>
              setSelectedScenarioId(selectedScenarioId === scenario.id ? '' : scenario.id)
            }
            onLoadScenario={onLoadScenario}
          />
        ))}
      </div>
    </>
  )
}
