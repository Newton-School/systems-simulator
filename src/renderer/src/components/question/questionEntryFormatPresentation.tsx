import {
  formatQuestionEntryFormat,
  resolveQuestionEntryFormat,
  type QuestionEntryFormat,
  type QuestionPackage
} from '../../../../engine/analysis/question'
import type { SimulationVerdict } from '../../../../engine/analysis/verdict'
import type { ExperienceEnvelope } from '@renderer/utils/experienceEnvelope'

export interface EntryFormatWorkflowStep {
  label: string
  detail: string
}

export interface EntryFormatHighlight {
  label: string
  value: string
}

export interface QuestionEntryFormatPresentation {
  entryFormat: QuestionEntryFormat
  entryFormatLabel: string
  title: string
  description: string
  guideTitle: string
  guideBody: string
  steps: readonly EntryFormatWorkflowStep[]
  highlights: readonly EntryFormatHighlight[]
}

export interface QuestionExperienceRuntimeState {
  hasTopologyEdits: boolean
  hasCurrentEvaluation: boolean
  evaluationPassed: boolean
  testRunCount: number
}

export interface WorkflowTrackerStep extends EntryFormatWorkflowStep {
  status: 'complete' | 'current' | 'pending'
}

export interface QuestionWorkflowTracker {
  progressLabel: string
  nextAction: string
  steps: readonly WorkflowTrackerStep[]
}

function formatWholeNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : `${Math.round(value * 10) / 10}`
}

function formatPeakRps(question: QuestionPackage): string | null {
  return typeof question.prompt.scale.peakRps === 'number'
    ? `${formatWholeNumber(question.prompt.scale.peakRps)} rps`
    : null
}

function formatReadWriteRatio(question: QuestionPackage): string | null {
  const ratio = question.prompt.scale.readWriteRatio
  return typeof ratio === 'number' ? `${ratio}:${100 - ratio}` : null
}

function scaffoldNodeCount(question: QuestionPackage): number {
  return question.scaffold.topology?.nodes.length ?? 0
}

function scaffoldEdgeCount(question: QuestionPackage): number {
  return question.scaffold.topology?.edges.length ?? 0
}

function formatLatencyMs(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 10) / 10} ms`
}

function formatThroughput(value: number): string {
  return `${formatWholeNumber(value)} req/s`
}

function formatErrorRate(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`
}

function baselineHighlights(verdict: SimulationVerdict | undefined): EntryFormatHighlight[] {
  if (!verdict) {
    return [{ label: 'Baseline verdict', value: 'Missing' }]
  }

  return [
    { label: 'Baseline p99', value: formatLatencyMs(verdict.summary.latency.p99) },
    { label: 'Baseline throughput', value: formatThroughput(verdict.summary.throughput) },
    { label: 'Baseline error rate', value: formatErrorRate(verdict.summary.errorRate) }
  ]
}

function commonChecksHighlight(question: QuestionPackage): EntryFormatHighlight {
  return { label: 'Authored checks', value: String(question.rubric.checks.length) }
}

function buildHighlights(
  entryFormat: QuestionEntryFormat,
  question: QuestionPackage
): EntryFormatHighlight[] {
  const peakRps = formatPeakRps(question)
  const readWrite = formatReadWriteRatio(question)
  const nodeCount = scaffoldNodeCount(question)
  const edgeCount = scaffoldEdgeCount(question)

  switch (entryFormat) {
    case 'blank-canvas':
      return [
        { label: 'Canvas', value: 'Blank' },
        commonChecksHighlight(question),
        ...(peakRps ? [{ label: 'Peak RPS', value: peakRps }] : []),
        ...(readWrite ? [{ label: 'Read / Write', value: readWrite }] : [])
      ]
    case 'requirements-first':
      return [
        { label: 'FRs', value: String(question.prompt.functionalRequirements.length) },
        { label: 'NFRs', value: String(question.prompt.nonFunctionalRequirements.length) },
        ...(peakRps ? [{ label: 'Peak RPS', value: peakRps }] : []),
        ...(nodeCount > 0 ? [{ label: 'Starter nodes', value: String(nodeCount) }] : [])
      ]
    case 'partial-scaffold':
      return [
        { label: 'Starter nodes', value: String(nodeCount) },
        { label: 'Starter edges', value: String(edgeCount) },
        commonChecksHighlight(question),
        ...(readWrite ? [{ label: 'Read / Write', value: readWrite }] : [])
      ]
    case 'broken-scaffold':
      return [
        { label: 'Starter nodes', value: String(nodeCount) },
        { label: 'Starter edges', value: String(edgeCount) },
        commonChecksHighlight(question),
        { label: 'Mode', value: 'Repair first' }
      ]
    case 'baseline-optimize':
      return [
        ...baselineHighlights(question.scaffold.baselineVerdict),
        { label: 'Starter nodes', value: String(nodeCount) }
      ]
    case 'locked-lab':
      return [
        { label: 'Fixed nodes', value: String(nodeCount) },
        { label: 'Fixed edges', value: String(edgeCount) },
        { label: 'Editing', value: 'Properties only' },
        { label: 'Cases', value: String(question.suite.cases.length) }
      ]
  }
}

export function buildQuestionEntryFormatPresentation(
  question: QuestionPackage
): QuestionEntryFormatPresentation {
  const entryFormat = resolveQuestionEntryFormat(question)
  const entryFormatLabel = formatQuestionEntryFormat(entryFormat)

  switch (entryFormat) {
    case 'blank-canvas':
      return {
        entryFormat,
        entryFormatLabel,
        title: 'Start from a blank canvas',
        description:
          'Nothing is pre-wired for you. Translate the prompt into the first architecture shape yourself.',
        guideTitle: 'Blank-Canvas Workflow',
        guideBody:
          'Read the brief, choose the first critical path, place the minimum topology that can satisfy it, then use the authored checks to validate the direction before you overbuild.',
        steps: [
          { label: 'Read the brief', detail: 'Anchor on the dominant path and bottleneck.' },
          { label: 'Place the first shape', detail: 'Add only the components the path truly needs.' },
          { label: 'Run the checks', detail: 'Use the authored rubric to see what the graph still lacks.' }
        ],
        highlights: buildHighlights(entryFormat, question)
      }
    case 'requirements-first':
      return {
        entryFormat,
        entryFormatLabel,
        title: 'Start from the requirements',
        description:
          'Use the FRs, NFRs, and scale as the primary scaffold, then refine the topology to satisfy them.',
        guideTitle: 'Requirements-First Workflow',
        guideBody:
          'Do not start by spraying components onto the canvas. Read the authored requirements, map them to paths and bottlenecks, then use the scaffold as a starting hypothesis rather than the answer.',
        steps: [
          { label: 'Extract FR / NFR / scale', detail: 'Turn the prompt into obligations before editing.' },
          { label: 'Map to paths and nodes', detail: 'Choose topology only after the requirement model is clear.' },
          { label: 'Run against the targets', detail: 'Use the checks to confirm the graph matches the requirements.' }
        ],
        highlights: buildHighlights(entryFormat, question)
      }
    case 'partial-scaffold':
      return {
        entryFormat,
        entryFormatLabel,
        title: 'Complete the starter topology',
        description:
          'A partial graph is already loaded. Finish the missing architecture instead of redrawing from zero.',
        guideTitle: 'Starter-Topology Workflow',
        guideBody:
          'Treat the scaffold as the first half of the answer. Inspect what is already present, identify what is intentionally omitted, then complete the graph with the smallest set of additions that satisfies the rubric.',
        steps: [
          { label: 'Inspect the starter graph', detail: 'Understand what the author already fixed in place.' },
          { label: 'Add the missing structure', detail: 'Complete the path rather than rebuilding the whole design.' },
          { label: 'Run completion checks', detail: 'Verify the finished topology closes the authored gaps.' }
        ],
        highlights: buildHighlights(entryFormat, question)
      }
    case 'broken-scaffold':
      return {
        entryFormat,
        entryFormatLabel,
        title: 'Repair the flawed starter',
        description:
          'The provided topology is intentionally wrong or incomplete. Diagnose it, then repair it.',
        guideTitle: 'Repair Workflow',
        guideBody:
          'Do not throw the whole graph away by default. First identify what is broken in the authored starter, then repair the topology so the intended path and semantics become correct again.',
        steps: [
          { label: 'Inspect the failure shape', detail: 'Find the wrong primitive, missing path, or bad placement.' },
          { label: 'Repair the graph', detail: 'Change only what is necessary to restore the design intent.' },
          { label: 'Re-run the rubric', detail: 'Confirm the repair closes the authored failure modes.' }
        ],
        highlights: buildHighlights(entryFormat, question)
      }
    case 'baseline-optimize':
      return {
        entryFormat,
        entryFormatLabel,
        title: 'Beat the baseline',
        description:
          'A working but suboptimal design is already loaded. Improve it and compare against the baseline verdict.',
        guideTitle: 'Optimization Workflow',
        guideBody:
          'Use the baseline verdict as a clue about where the current bottleneck lives. Tune the graph to improve the targeted metrics without papering over the problem with unnecessary complexity.',
        steps: [
          { label: 'Inspect the baseline', detail: 'Read the baseline metrics before you edit anything.' },
          { label: 'Attack the bottleneck', detail: 'Change the graph where the baseline is actually weak.' },
          { label: 'Run and compare', detail: 'Check whether the new topology improved on the baseline.' }
        ],
        highlights: buildHighlights(entryFormat, question)
      }
    case 'locked-lab':
      return {
        entryFormat,
        entryFormatLabel,
        title: 'Tune a fixed topology',
        description:
          'The architecture stays fixed. Change behavior by adjusting parameters and then inspect the results.',
        guideTitle: 'Lab Workflow',
        guideBody:
          'Keep the graph structure fixed. Use the properties panel and the results tray to see how parameter changes alter throughput, saturation, latency, and failures.',
        steps: [
          { label: 'Inspect the fixed graph', detail: 'Understand the authored topology before tuning it.' },
          { label: 'Adjust properties', detail: 'Change behavior through configuration, not architecture edits.' },
          { label: 'Run and compare', detail: 'Use the results tray to compare the effect of each change.' }
        ],
        highlights: buildHighlights(entryFormat, question)
      }
  }
}

function buildWorkflowStatuses(
  steps: readonly EntryFormatWorkflowStep[],
  runtime: QuestionExperienceRuntimeState
): WorkflowTrackerStep[] {
  const stage = runtime.evaluationPassed
    ? steps.length
    : runtime.hasCurrentEvaluation
      ? Math.max(steps.length - 1, 0)
      : runtime.hasTopologyEdits
        ? Math.max(steps.length - 2, 0)
        : 0

  return steps.map((step, index) => ({
    ...step,
    status:
      index < stage
        ? 'complete'
        : index === stage && stage < steps.length
          ? 'current'
          : 'pending'
  }))
}

function workflowNextAction(
  entryFormat: QuestionEntryFormat,
  runtime: QuestionExperienceRuntimeState
): string {
  if (runtime.evaluationPassed) {
    return 'Current topology satisfies the authored checks. Keep iterating only if you want to compare alternatives.'
  }
  if (runtime.hasCurrentEvaluation) {
    return entryFormat === 'locked-lab'
      ? 'Use the latest run to tune one property at a time, then run the lab again.'
      : 'Use the latest run to refine the bottleneck you just measured, then evaluate again.'
  }
  if (runtime.hasTopologyEdits) {
    return entryFormat === 'requirements-first'
      ? 'Run the current graph against the authored requirements before adding more components.'
      : entryFormat === 'locked-lab'
        ? 'Run the lab now so the results tray reflects the current configuration.'
        : 'Run the authored checks now to validate the current topology.'
  }
  return entryFormat === 'requirements-first'
    ? 'Start from the brief: map the FRs, NFRs, and scale into the first concrete path before expanding the graph.'
    : entryFormat === 'locked-lab'
      ? 'Inspect the fixed topology first, then change one parameter that should move the bottleneck.'
      : 'Inspect the starter shape first, then make the smallest change that advances the design.'
}

export function buildQuestionWorkflowTracker(
  question: QuestionPackage,
  runtime: QuestionExperienceRuntimeState
): QuestionWorkflowTracker {
  const presentation = buildQuestionEntryFormatPresentation(question)
  const steps = buildWorkflowStatuses(presentation.steps, runtime)
  const completedSteps = steps.filter((step) => step.status === 'complete').length

  return {
    progressLabel: `${completedSteps}/${steps.length} steps complete`,
    nextAction: workflowNextAction(presentation.entryFormat, runtime),
    steps
  }
}

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
          <div
            key={step.label}
            className="rounded-md border border-white/10 bg-black/10 px-3 py-2"
          >
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
