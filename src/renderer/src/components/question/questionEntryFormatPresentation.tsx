import type { QuestionEntryFormat, QuestionPackage } from '../../../../engine/analysis/question'
import type { ExperienceEnvelope } from '@renderer/utils/experienceEnvelope'
import {
  buildQuestionEntryFormatPresentation,
  buildQuestionWorkflowTracker,
  type QuestionExperienceRuntimeState
} from './questionEntryFormatPresentationModel'

/**
 * Kill-switch for the entry-format workflow scaffolding (the top experience
 * strip and the brief's guide card). Synthesized for every question today, it is
 * reserved for a future redesign and force-hidden. Flip to `true` to bring back.
 */
export const SHOW_ENTRY_FORMAT_WORKFLOW = false

const ENTRY_TONE: Record<QuestionEntryFormat, string> = {
  'blank-canvas': 'border-nss-border bg-nss-panel',
  'requirements-first': 'border-nss-primary/25 bg-nss-primary/10',
  'partial-scaffold': 'border-sky-500/25 bg-sky-500/10',
  'broken-scaffold': 'border-amber-500/25 bg-amber-500/10',
  'baseline-optimize': 'border-emerald-500/25 bg-emerald-500/10',
  'locked-lab': 'border-cyan-500/25 bg-cyan-500/10'
}

export function QuestionExperienceStrip({
  question,
  experience,
  runtime = {
    hasTopologyEdits: false,
    hasCurrentEvaluation: false,
    evaluationPassed: false,
    testRunCount: 0
  }
}: {
  question: QuestionPackage
  experience: Pick<ExperienceEnvelope, 'label' | 'entryFormatLabel'>
  runtime?: QuestionExperienceRuntimeState
}): React.JSX.Element {
  const presentation = buildQuestionEntryFormatPresentation(question)
  const workflow = buildQuestionWorkflowTracker(question, runtime)
  const tone = ENTRY_TONE[presentation.entryFormat]

  return (
    <section className={`border-b px-4 py-3 ${tone}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-black/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-nss-text">
                {experience.label}
              </span>
              <span className="rounded-full border border-white/10 bg-black/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
                {experience.entryFormatLabel ?? presentation.entryFormatLabel}
              </span>
            </div>
            <h2 className="mt-2 text-sm font-semibold text-nss-text">{presentation.title}</h2>
            <p className="mt-1 max-w-4xl text-[11px] leading-relaxed text-nss-text/85">
              {presentation.description}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-nss-muted">
              <span>{workflow.progressLabel}</span>
              <span>Test runs: {runtime.testRunCount}</span>
            </div>
          </div>

          <div className="grid min-w-[240px] grid-cols-2 gap-2 text-[11px]">
            {presentation.highlights.map((highlight) => (
              <div
                key={highlight.label}
                className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5"
              >
                <div className="text-[10px] uppercase tracking-wide text-nss-muted">
                  {highlight.label}
                </div>
                <div className="mt-0.5 font-semibold text-nss-text">{highlight.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-nss-muted">
            Current Focus
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-nss-text/85">{workflow.nextAction}</p>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {workflow.steps.map((step, index) => (
            <div
              key={step.label}
              className={`rounded-md border px-3 py-2 ${
                step.status === 'complete'
                  ? 'border-emerald-400/20 bg-emerald-500/10'
                  : step.status === 'current'
                    ? 'border-nss-primary/35 bg-nss-primary/10'
                    : 'border-white/10 bg-black/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-nss-muted">
                  Step {index + 1}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    step.status === 'complete'
                      ? 'bg-emerald-500/15 text-emerald-200'
                      : step.status === 'current'
                        ? 'bg-nss-primary/15 text-nss-primary'
                        : 'bg-black/15 text-nss-muted'
                  }`}
                >
                  {step.status}
                </span>
              </div>
              <div className="mt-1 text-[11px] font-semibold text-nss-text">{step.label}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-nss-text/80">{step.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function QuestionEntryFormatGuideCard({
  question
}: {
  question: QuestionPackage
}): React.JSX.Element {
  const presentation = buildQuestionEntryFormatPresentation(question)
  const tone = ENTRY_TONE[presentation.entryFormat]

  return (
    <section className={`rounded-md border px-3 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/10 bg-black/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
          {presentation.entryFormatLabel}
        </span>
        <h3 className="text-[11px] font-semibold text-nss-text">{presentation.guideTitle}</h3>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-nss-text/85">{presentation.guideBody}</p>

      <div className="mt-3 grid gap-2">
        {presentation.steps.map((step, index) => (
          <div key={step.label} className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-nss-muted">
              Step {index + 1}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-nss-text">{step.label}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-nss-text/80">{step.detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
