import { BookOpen, X } from 'lucide-react'
import type { SampleScenario } from '@renderer/config/sampleScenarios'

interface SampleScenarioPickerProps {
  samples: SampleScenario[]
  onLoad: (sample: SampleScenario) => void
  onClose: () => void
}

export function SampleScenarioPicker({ samples, onLoad, onClose }: SampleScenarioPickerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sample-picker-title"
        className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-nss-border bg-nss-panel shadow-2xl shadow-slate-950/25"
      >
        <header className="flex items-start justify-between gap-4 border-b border-nss-border px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-nss-muted">Open Samples</p>
            <h2 id="sample-picker-title" className="mt-1 text-xl font-semibold text-nss-text">
              Choose a system-design story
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sample picker"
            className="rounded p-2 text-nss-muted transition-colors hover:bg-nss-text/10 hover:text-nss-text focus:outline-none focus:ring-2 focus:ring-nss-primary"
          >
            <X size={18} />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {samples.map((sample) => (
              <article
                key={sample.id}
                className="group flex min-h-52 flex-col rounded border border-nss-border bg-nss-surface p-4 text-left transition-colors hover:border-nss-primary/60 hover:bg-nss-bg"
              >
                <div>
                  <p className="text-sm font-semibold text-nss-text">{sample.name}</p>
                  <p className="mt-0.5 text-xs text-nss-muted">{sample.subtitle}</p>
                </div>

                <p className="mt-3 rounded border border-nss-border bg-nss-panel px-3 py-2 text-xs text-nss-text">
                  {sample.diagram}
                </p>

                <div className="mt-3 space-y-2 text-xs leading-5">
                  <p className="text-nss-text/85">
                    <span className="font-semibold text-nss-text">Use case:</span>{' '}
                    {sample.primaryUseCase}
                  </p>
                  <p className="text-nss-text/85">
                    <span className="font-semibold text-nss-text">Simulator value:</span>{' '}
                    {sample.simulatorValue}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onLoad(sample)}
                  className="mt-auto inline-flex h-8 items-center justify-center rounded bg-nss-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-nss-primary/85 focus:outline-none focus:ring-2 focus:ring-nss-primary"
                >
                  Open Sample
                </button>
              </article>
            ))}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-nss-border px-5 py-3 text-xs text-nss-muted">
          <BookOpen size={14} />
          Samples replace the current canvas and use abstract configs, not implementation details.
        </footer>
      </section>
    </div>
  )
}
