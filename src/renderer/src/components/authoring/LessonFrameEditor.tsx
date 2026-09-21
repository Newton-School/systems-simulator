import { Hash } from 'lucide-react'
import { deriveQuestionIdFromTitle } from '../../../../engine/analysis/questionAuthoringDraft'
import { RequiredIndicator } from './RequiredIndicator'

interface LessonFrameEditorProps {
  title: string
  onTitleChange: (title: string) => void
}

export function LessonFrameEditor({
  title,
  onTitleChange
}: LessonFrameEditorProps): React.JSX.Element {
  const questionId = deriveQuestionIdFromTitle(title)
  const hasTitle = title.trim().length > 0

  return (
    <section
      className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
      aria-labelledby="question-identity-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Question identity
          </p>
          <h3 id="question-identity-title" className="mt-1 text-base font-semibold text-nss-text">
            Name this question
          </h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            Start with the learner-facing title. The package ID is generated from it automatically.
          </p>
        </div>
        <span className="rounded-full border border-nss-border px-2.5 py-1 text-[10px] font-medium text-nss-muted">
          Required
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(12rem,1fr)]">
        <label className="block text-xs font-semibold text-nss-text">
          Question title <RequiredIndicator />
          <input
            id="question-title"
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.currentTarget.value)}
            placeholder="e.g. Design a URL shortener"
            aria-describedby="question-title-help"
            required
            className="mt-2 block w-full rounded-md border border-nss-border bg-nss-input-bg px-3 py-2.5 text-sm font-normal text-nss-text outline-none placeholder:text-nss-placeholder focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
          />
          <span
            id="question-title-help"
            className={`mt-1.5 block text-[11px] font-normal ${hasTitle ? 'text-nss-muted' : 'text-nss-warning'}`}
          >
            {hasTitle
              ? 'This title will appear to learners.'
              : 'Add a title to complete question identity.'}
          </span>
        </label>

        <div>
          <p className="text-xs font-semibold text-nss-text">Generated question ID</p>
          <div className="mt-2 flex min-h-10 items-center gap-2 rounded-md border border-nss-border bg-nss-surface px-3 py-2">
            <Hash size={14} className="shrink-0 text-nss-muted" aria-hidden="true" />
            <output
              htmlFor="question-title"
              aria-live="polite"
              className="min-w-0 break-all font-mono text-xs text-nss-text"
            >
              {questionId}
            </output>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-nss-muted">
            Lowercase letters, numbers, and hyphens. It updates with the title.
          </p>
        </div>
      </div>
    </section>
  )
}
