import { Eye, FileText } from 'lucide-react'
import { useMemo } from 'react'
import {
  compileAuthoringNfr,
  type AuthoringNonFunctionalRequirement,
  type NonFunctionalRequirementAction
} from '../../../../engine/analysis/questionAuthoringNfr'
import type {
  AuthoringFunctionalRequirement,
  FunctionalRequirementAction
} from '../../../../engine/analysis/questionAuthoringRequirements'
import { buildQuestionTextHtml } from '../../../../engine/analysis/questionTextHtml'
import type { ScaleParameters } from '../../../../engine/analysis/question'
import { sanitizeQuestionPromptHtml } from '../../utils/questionPromptHtml'
import { FunctionalRequirementsEditor } from './FunctionalRequirementsEditor'
import { NonFunctionalRequirementsEditor } from './NonFunctionalRequirementsEditor'
import { RequiredIndicator } from './RequiredIndicator'

interface LearnerBriefPreviewProps {
  questionTitle: string
  problemStatement: string
  functionalRequirements: readonly AuthoringFunctionalRequirement[]
  nonFunctionalRequirements: readonly AuthoringNonFunctionalRequirement[]
  additionalContext?: string
  scale?: ScaleParameters
}

export function LearnerBriefPreview({
  questionTitle,
  problemStatement,
  functionalRequirements,
  nonFunctionalRequirements,
  additionalContext,
  scale = {}
}: LearnerBriefPreviewProps): React.JSX.Element {
  const learnerRequirements = useMemo(
    () =>
      functionalRequirements
        .map((requirement) => requirement.text.trim())
        .filter((text) => text.length > 0),
    [functionalRequirements]
  )
  const learnerNfrs = useMemo(
    () =>
      nonFunctionalRequirements
        .map(compileAuthoringNfr)
        .filter(
          (requirement): requirement is NonNullable<typeof requirement> => requirement !== null
        ),
    [nonFunctionalRequirements]
  )
  const previewHtml = useMemo(
    () =>
      sanitizeQuestionPromptHtml(
        buildQuestionTextHtml({
          text: problemStatement,
          functionalRequirements: learnerRequirements,
          nonFunctionalRequirements: learnerNfrs,
          scale,
          additionalContext
        })
      ),
    [additionalContext, learnerNfrs, learnerRequirements, problemStatement, scale]
  )
  const hasContent =
    problemStatement.trim().length > 0 || learnerRequirements.length > 0 || learnerNfrs.length > 0

  return (
    <aside
      className="rounded-xl border border-nss-border bg-nss-panel shadow-sm"
      aria-labelledby="learner-preview-title"
    >
      <div className="flex items-center justify-between border-b border-nss-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye size={15} className="text-nss-primary" aria-hidden="true" />
          <h3 id="learner-preview-title" className="text-xs font-semibold text-nss-text">
            Learner preview
          </h3>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wide text-nss-muted">Live</span>
      </div>

      <div className="min-h-56 p-5" aria-live="polite">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-nss-muted">
          System design question
        </p>
        <h4 className="mt-2 text-lg font-semibold tracking-tight text-nss-text">
          {questionTitle.trim() || 'Untitled question'}
        </h4>

        {hasContent ? (
          <div
            data-testid="learner-brief-content"
            className="mt-5 text-sm leading-6 text-nss-text/90 [&_br]:content-[''] [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-xs [&_h3]:font-semibold [&_li]:mb-1 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-4 py-5 text-center">
            <FileText size={20} className="mx-auto text-nss-muted" aria-hidden="true" />
            <p className="mt-2 text-xs leading-5 text-nss-muted">
              The learner-facing problem statement will appear here.
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}

interface QuestionBriefEditorProps extends LearnerBriefPreviewProps {
  onProblemStatementChange: (text: string) => void
  onFunctionalRequirementAction: (action: FunctionalRequirementAction) => void
  onNonFunctionalRequirementAction: (action: NonFunctionalRequirementAction) => void
}

export function QuestionBriefEditor({
  questionTitle,
  problemStatement,
  functionalRequirements,
  nonFunctionalRequirements,
  additionalContext,
  scale,
  onProblemStatementChange,
  onFunctionalRequirementAction,
  onNonFunctionalRequirementAction
}: QuestionBriefEditorProps): React.JSX.Element {
  const hasContent = problemStatement.trim().length > 0

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <section
          className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
          aria-labelledby="problem-statement-title"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Learner brief
          </p>
          <h3 id="problem-statement-title" className="mt-1 text-base font-semibold text-nss-text">
            Describe the problem
          </h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            Explain the system, user need, and design challenge in plain language. Formatting is
            generated safely for the learner.
          </p>

          <label className="mt-5 block text-xs font-semibold text-nss-text">
            Problem statement <RequiredIndicator />
            <textarea
              id="problem-statement"
              value={problemStatement}
              onChange={(event) => onProblemStatementChange(event.currentTarget.value)}
              placeholder="Describe what the learner must design and why it matters…"
              rows={9}
              aria-describedby="problem-statement-help"
              required
              className="mt-2 block w-full resize-y rounded-md border border-nss-border bg-nss-input-bg px-3 py-2.5 text-sm font-normal leading-6 text-nss-text outline-none placeholder:text-nss-placeholder focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
            />
            <span
              id="problem-statement-help"
              className={`mt-1.5 block text-[11px] font-normal ${hasContent ? 'text-nss-muted' : 'text-nss-warning'}`}
            >
              {hasContent
                ? `${problemStatement.length.toLocaleString()} characters · HTML is escaped automatically.`
                : 'Add a problem statement to complete the learner brief.'}
            </span>
          </label>
        </section>

        <LearnerBriefPreview
          questionTitle={questionTitle}
          problemStatement={problemStatement}
          functionalRequirements={functionalRequirements}
          nonFunctionalRequirements={nonFunctionalRequirements}
          additionalContext={additionalContext}
          scale={scale}
        />
      </div>

      <FunctionalRequirementsEditor
        requirements={functionalRequirements}
        onAction={onFunctionalRequirementAction}
      />
      <NonFunctionalRequirementsEditor
        requirements={nonFunctionalRequirements}
        onAction={onNonFunctionalRequirementAction}
      />
    </div>
  )
}
