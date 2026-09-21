import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react'

const FOUNDATION_ITEMS = [
  'Shared Newton row codec',
  '14 / 14 package round-trips',
  'Engine-owned capability registry'
] as const

const DRAFT_ITEMS = ['Question identity', 'Learner brief', 'Scenario', 'Grading contract'] as const

interface AuthoringReadinessPanelProps {
  hasQuestionIdentity: boolean
  hasLearnerBrief: boolean
  hasScenario: boolean
  hasGrading: boolean
}

export function AuthoringReadinessPanel({
  hasQuestionIdentity,
  hasLearnerBrief,
  hasScenario,
  hasGrading
}: AuthoringReadinessPanelProps): React.JSX.Element {
  const completion = [hasQuestionIdentity, hasLearnerBrief, hasScenario, hasGrading]
  const readyCount = completion.filter(Boolean).length

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-nss-border bg-nss-panel max-[900px]:hidden">
      <div className="border-b border-nss-border px-4 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-nss-success" aria-hidden="true" />
          <h2 className="text-xs font-semibold text-nss-text">Readiness</h2>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-nss-surface">
          <div
            className="h-full rounded-full bg-nss-primary transition-[width]"
            style={{ width: `${readyCount * 25}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-4 text-nss-muted">
          Foundation ready. Authoring content is still a draft.
        </p>
      </div>

      <section className="border-b border-nss-border px-4 py-4" aria-labelledby="foundation-title">
        <h3
          id="foundation-title"
          className="text-[11px] font-semibold uppercase tracking-wide text-nss-muted"
        >
          Contract foundation
        </h3>
        <ul className="mt-3 space-y-2.5">
          {FOUNDATION_ITEMS.map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs text-nss-text">
              <CheckCircle2
                size={14}
                className="mt-0.5 shrink-0 text-nss-success"
                aria-hidden="true"
              />
              <span>{item}</span>
              <span className="sr-only">Ready</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 py-4" aria-labelledby="draft-title">
        <div className="flex items-center justify-between gap-2">
          <h3
            id="draft-title"
            className="text-[11px] font-semibold uppercase tracking-wide text-nss-muted"
          >
            Draft checklist
          </h3>
          <span className="text-[10px] font-medium text-nss-muted">{readyCount} / 4</span>
        </div>
        <ul className="mt-3 space-y-2.5">
          {DRAFT_ITEMS.map((item, index) => {
            const complete = completion[index]
            const Icon = complete ? CheckCircle2 : Circle
            return (
              <li
                key={item}
                className={`flex items-start gap-2 text-xs ${complete ? 'text-nss-text' : 'text-nss-muted'}`}
              >
                <Icon
                  size={14}
                  className={`mt-0.5 shrink-0 ${complete ? 'text-nss-success' : ''}`}
                  aria-hidden="true"
                />
                <span>{item}</span>
                <span className="sr-only">{complete ? 'Complete' : 'Not started'}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
