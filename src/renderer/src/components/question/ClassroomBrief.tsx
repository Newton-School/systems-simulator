import type { QuestionPackage } from '../../../../engine/analysis/question'
import type { ClassroomFeedbackResult } from '../../../../engine/classroom/compileClassroom'
import type { ClassroomMisconceptionResult } from '../../../../engine/classroom/misconceptions'
import { classroomGivensTable } from '../../../../engine/classroom/givensTable'

const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-nss-muted'

/**
 * The givens table on a Classroom brief: the numbers the problem states, built
 * from the question's givens so the prompt and canvas always agree.
 */
export function ClassroomGivensTable({
  question
}: {
  question: QuestionPackage
}): React.JSX.Element | null {
  const rows = classroomGivensTable(question)
  if (rows.length === 0) return null
  return (
    <section className="space-y-2" aria-labelledby="classroom-givens-title">
      {(question.classroom?.objectives?.length ?? 0) > 0 && (
        <div className="mb-4 space-y-2">
          <h3 className={SECTION_TITLE}>What you&apos;ll practise</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-nss-text/90">
            {question.classroom?.objectives?.map((objective) => (
              <li key={objective.id}>{objective.statement}</li>
            ))}
          </ul>
        </div>
      )}
      <h3 id="classroom-givens-title" className={SECTION_TITLE}>
        What you&apos;re given
      </h3>
      <table className="w-full border-collapse text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-nss-border/60 last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-semibold text-nss-text">
                {row.component}
              </th>
              <td className="py-1.5 text-nss-text/90">{row.given}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] leading-relaxed text-nss-muted">
        These are the facts of the problem. You decide which components to use, how they connect,
        and how many instances of each you need.
      </p>
    </section>
  )
}

/** Highest-priority teaching response for the learner's current design. */
export function ClassroomMisconceptionCard({
  misconceptions
}: {
  misconceptions: readonly ClassroomMisconceptionResult[]
}): React.JSX.Element | null {
  const misconception = misconceptions[0]
  if (!misconception) return null
  return (
    <section
      role="status"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed"
      aria-labelledby="classroom-teaching-message"
    >
      <h3
        id="classroom-teaching-message"
        className="font-semibold text-amber-800 dark:text-amber-200"
      >
        {misconception.title}
      </h3>
      <p className="mt-1 text-nss-text">{misconception.message}</p>
      {misconception.nudge && (
        <p className="mt-2 font-medium text-amber-800 dark:text-amber-200">
          Try this: {misconception.nudge}
        </p>
      )}
    </section>
  )
}

/**
 * Feedback-only Classroom checks that fired: shown after a run, never part of
 * the score. Passing feedback stays quiet, so it can't hint at the answer.
 */
export function ClassroomFeedbackList({
  feedback: all
}: {
  feedback: readonly ClassroomFeedbackResult[]
}): React.JSX.Element | null {
  const feedback = all.filter((item) => !item.passed)
  if (feedback.length === 0) return null
  return (
    <section className="space-y-2" aria-labelledby="classroom-feedback-title">
      <h3 id="classroom-feedback-title" className={SECTION_TITLE}>
        Feedback (not scored)
      </h3>
      <ul className="space-y-1.5">
        {feedback.map((item) => (
          <li
            key={item.id}
            className="rounded border border-nss-border bg-nss-surface px-3 py-2 text-[11px] leading-relaxed"
          >
            <span
              className={`mr-2 font-semibold ${item.passed ? 'text-nss-success' : 'text-nss-warning'}`}
            >
              {item.passed ? '✓' : '!'}
            </span>
            <span className="font-semibold text-nss-text">{item.label}</span>
            {item.detail && <p className="mt-1 text-nss-muted">{item.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}
