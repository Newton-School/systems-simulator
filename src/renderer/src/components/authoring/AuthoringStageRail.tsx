import { QUESTION_STUDIO_STAGES, type AuthoringStageId } from './questionStudioStages'

interface AuthoringStageRailProps {
  activeStage: AuthoringStageId
  onStageChange: (stage: AuthoringStageId) => void
}

export function AuthoringStageRail({
  activeStage,
  onStageChange
}: AuthoringStageRailProps): React.JSX.Element {
  return (
    <nav
      aria-label="Question authoring stages"
      className="flex min-h-0 flex-col border-r border-nss-border bg-nss-panel"
    >
      <div className="border-b border-nss-border px-4 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-muted">
          Authoring flow
        </p>
        <p className="mt-1 text-xs text-nss-muted">Move between stages at any time.</p>
      </div>

      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {QUESTION_STUDIO_STAGES.map((stage) => {
          const active = stage.id === activeStage
          const Icon = stage.icon
          return (
            <li key={stage.id}>
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                onClick={() => onStageChange(stage.id)}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-nss-primary/70 ${
                  active
                    ? 'bg-nss-primary/10 text-nss-primary'
                    : 'text-nss-text hover:bg-nss-surface'
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
                    active
                      ? 'border-nss-primary/30 bg-nss-panel'
                      : 'border-nss-border bg-nss-surface text-nss-muted'
                  }`}
                >
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">
                    {stage.number}. {stage.label}
                  </span>
                  <span className="block truncate text-[11px] text-nss-muted">
                    {stage.shortDescription}
                  </span>
                </span>
                {active && <span className="sr-only">Current stage</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
