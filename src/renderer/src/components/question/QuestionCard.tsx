import { ChevronDown, ChevronUp, FileText } from 'lucide-react'
import type { QuestionPackage } from '../../../../engine/analysis/question'
import { summarizeQuestionBrief } from './questionCardModel'

/**
 * Simple shell's question card: the task in one glance, pinned over the canvas, instead of a
 * sidebar tab. It collapses to a one-line chip once the learner starts building; the full
 * brief (requirements, tests, submit) stays in the sidebar behind "Show full brief".
 */
export function QuestionCard({
  question,
  expanded,
  onToggle,
  onShowFullBrief
}: {
  question: QuestionPackage
  expanded: boolean
  onToggle: () => void
  onShowFullBrief: () => void
}): React.JSX.Element {
  const brief = summarizeQuestionBrief(question)

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        title="Show the task"
        data-testid="question-card"
        className="absolute left-3 top-3 z-20 flex max-w-[min(22rem,calc(100%-1.5rem))] items-center gap-2 rounded-lg border border-nss-border bg-nss-panel/95 px-3 py-1.5 text-left text-xs text-nss-text shadow-md backdrop-blur transition-colors hover:border-nss-primary/50"
      >
        <FileText size={14} className="shrink-0 text-nss-muted" />
        <span className="truncate font-semibold">{brief.title}</span>
        <ChevronDown size={14} className="shrink-0 text-nss-muted" />
      </button>
    )
  }

  return (
    <section
      aria-label="Task"
      data-testid="question-card"
      className="absolute left-3 top-3 z-20 w-[min(22rem,calc(100%-1.5rem))] space-y-2 rounded-lg border border-nss-border bg-nss-panel/95 p-3 text-xs shadow-md backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">Task</p>
          <h2 className="font-semibold text-nss-text">{brief.title}</h2>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse task"
          aria-expanded
          className="rounded p-1 text-nss-muted transition-colors hover:bg-nss-surface hover:text-nss-text"
        >
          <ChevronUp size={14} />
        </button>
      </div>
      {brief.summary && <p className="leading-relaxed text-nss-text/90">{brief.summary}</p>}
      {brief.targets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Targets">
          {brief.targets.map((target) => (
            <li
              key={target}
              className="rounded-md border border-nss-border bg-nss-surface px-2 py-0.5 text-[11px] text-nss-muted"
            >
              {target}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onShowFullBrief}
        className="font-semibold text-nss-primary transition-colors hover:underline"
      >
        Show full brief
      </button>
    </section>
  )
}
