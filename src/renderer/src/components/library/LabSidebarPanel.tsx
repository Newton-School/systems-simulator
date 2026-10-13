import useStore from '../../store/useStore'
import { SAMPLE_LABS } from '../../config/sampleLabs'
import { ArrowRight, Clock3, SlidersHorizontal } from 'lucide-react'

export function LabSidebarPanel(): React.JSX.Element {
  const requestQuestionLoad = useStore((state) => state.requestQuestionLoad)

  return (
    <>
      <div className="shrink-0 border-b border-nss-border p-4">
        <div className="flex items-center gap-2 text-nss-primary">
          <SlidersHorizontal size={16} />
          <h2 className="text-xs font-bold uppercase tracking-widest">Guided labs</h2>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-nss-muted">
          Start with a working architecture, change one setting, and see what moves. The graph stays
          fixed so you can focus on cause and effect.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {SAMPLE_LABS.map((lab) => (
          <article
            key={lab.id}
            className="group overflow-hidden rounded-lg border border-nss-border bg-nss-surface/40 transition-colors hover:border-nss-primary/40"
          >
            <div className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-nss-text">{lab.title}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">{lab.summary}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-nss-muted">
                  <Clock3 size={11} /> 15 min
                </span>
              </div>

              <div className="rounded-md bg-nss-primary/8 px-2.5 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-nss-primary">
                  You will explore
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-nss-text/85">{lab.focus}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => requestQuestionLoad(lab.question)}
              className="flex w-full items-center justify-between border-t border-nss-border px-3 py-2.5 text-xs font-semibold text-nss-primary transition-colors hover:bg-nss-primary/10"
            >
              Start lab
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </article>
        ))}
      </div>
    </>
  )
}
