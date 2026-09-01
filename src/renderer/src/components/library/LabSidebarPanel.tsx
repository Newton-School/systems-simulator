import useStore from '../../store/useStore'
import { SAMPLE_LABS } from '../../config/sampleLabs'

export function LabSidebarPanel(): React.JSX.Element {
  const requestQuestionLoad = useStore((state) => state.requestQuestionLoad)

  return (
    <>
      <div className="shrink-0 space-y-1 border-b border-nss-border p-4 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">Labs</h2>
        <p className="text-[11px] leading-relaxed text-nss-muted">
          Locked-down concept labs that reuse the same simulator canvas, worker, and results tray.
          Open one to tune properties, not topology structure.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {SAMPLE_LABS.map((lab) => (
          <div
            key={lab.id}
            className="space-y-2 rounded-lg border border-nss-border bg-nss-panel p-3"
          >
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-nss-text">{lab.title}</h4>
              <p className="text-[11px] leading-relaxed text-nss-muted">{lab.summary}</p>
            </div>

            <div className="rounded-md border border-nss-primary/20 bg-nss-primary/10 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-primary">
                Focus
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-nss-text">{lab.focus}</p>
            </div>

            <div className="rounded-md border border-nss-border bg-nss-surface px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                Lab Flow
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-nss-text">
                {lab.guide}
              </p>
            </div>

            <button
              type="button"
              onClick={() => requestQuestionLoad(lab.question)}
              className="w-full rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90"
            >
              Open Lab
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
