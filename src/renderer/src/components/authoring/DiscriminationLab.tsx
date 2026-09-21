import { AlertTriangle, CheckCircle2, FlaskConical, Plus, Trash2, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { QuestionAuthoringPreview } from '../../../../engine/analysis/questionAuthoringCompiler'
import type { GamedTopologyDraft } from '../../../../engine/analysis/questionAuthoringProject'
import type { QuestionAuthoringVerificationProof } from '../../../../engine/analysis/questionAuthoringProject'
import {
  type QuestionAuthoringVerificationInput,
  type QuestionAuthoringVerificationReport,
  type VerificationDesignResult
} from '../../../../engine/analysis/questionAuthoringVerification'
import { computeVerificationSignature } from '../../../../engine/analysis/questionAuthoringVerificationSignature'
import type { TopologyJSON } from '../../../../engine/core/types'
import { AuthoringTopologyCanvas } from './AuthoringTopologyCanvas'

export interface ObligationOption {
  id: string
  label: string
  axis: 'structural' | 'semantic' | 'rubric'
}

interface DiscriminationLabProps {
  questionId: string
  preview: QuestionAuthoringPreview
  referenceTopology?: TopologyJSON
  gamedDesigns: readonly GamedTopologyDraft[]
  obligationOptions: readonly ObligationOption[]
  scaffoldTopology?: TopologyJSON
  onReferenceChange: (topology: TopologyJSON | undefined) => void
  onGamedChange: (designs: GamedTopologyDraft[]) => void
  onVerification: (proof: QuestionAuthoringVerificationProof) => void
}

type SelectedDesign = { kind: 'reference' } | { kind: 'gamed'; id: string }

function verdictPill(passed: boolean, labels: [pass: string, fail: string]): React.JSX.Element {
  return passed ? (
    <span className="inline-flex items-center gap-1 text-nss-success">
      <CheckCircle2 size={13} aria-hidden="true" />
      {labels[0]}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-nss-danger">
      <XCircle size={13} aria-hidden="true" />
      {labels[1]}
    </span>
  )
}

function MatrixRow({ design }: { design: VerificationDesignResult }): React.JSX.Element {
  const expected =
    design.role === 'reference'
      ? '—'
      : design.expectedDiscriminator === 'caught'
        ? 'caught'
        : design.expectedDiscriminator === 'missed'
          ? 'missed'
          : 'unattributed'
  const ready =
    design.role === 'reference'
      ? design.overallPassed
      : !design.overallPassed &&
        !design.accidentalFailure &&
        design.expectedDiscriminator !== 'missed'

  return (
    <tr className="border-t border-nss-border">
      <td className="px-3 py-2 text-xs font-semibold text-nss-text">
        {design.label}
        {design.misconception ? (
          <span className="block text-[10px] font-normal text-nss-muted">
            {design.misconception}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-xs">
        {verdictPill(design.structuralPassed, ['pass', 'fail'])}
      </td>
      <td className="px-3 py-2 text-xs">{verdictPill(design.semanticPassed, ['pass', 'fail'])}</td>
      <td className="px-3 py-2 text-xs">{verdictPill(design.rubricPassed, ['pass', 'fail'])}</td>
      <td className="px-3 py-2 text-xs">
        {design.role === 'reference' ? (
          <span className="text-nss-muted">—</span>
        ) : expected === 'caught' ? (
          <span className="text-nss-success">{expected}</span>
        ) : (
          <span className="text-nss-warning">{expected}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {verdictPill(ready, ['ready', 'no'])}
        {design.resolvedModes.length > 0 ? (
          <span className="block text-[10px] text-nss-muted">
            {design.resolvedModes.join(', ')}
          </span>
        ) : null}
      </td>
    </tr>
  )
}

export function DiscriminationLab({
  questionId,
  preview,
  referenceTopology,
  gamedDesigns,
  obligationOptions,
  scaffoldTopology,
  onReferenceChange,
  onGamedChange,
  onVerification
}: DiscriminationLabProps): React.JSX.Element {
  const [selected, setSelected] = useState<SelectedDesign>({ kind: 'reference' })
  const [report, setReport] = useState<QuestionAuthoringVerificationReport | null>(null)
  const [running, setRunning] = useState(false)

  const questionPackage = preview.status === 'ready' ? preview.questionPackage : null
  const allGamedHaveTopology = gamedDesigns.every((design) => design.topology)
  const canRun = Boolean(questionPackage && referenceTopology && allGamedHaveTopology)

  const verificationInput: QuestionAuthoringVerificationInput | null = useMemo(() => {
    if (!referenceTopology || !allGamedHaveTopology) return null
    return {
      reference: { id: 'reference', label: 'Reference', topology: referenceTopology },
      gamed: gamedDesigns.map((design) => ({
        id: design.id,
        label: design.label,
        topology: design.topology!,
        ...(design.misconception ? { misconception: design.misconception } : {}),
        ...(design.expectedObligationId
          ? { expectedObligationId: design.expectedObligationId }
          : {})
      }))
    }
  }, [allGamedHaveTopology, gamedDesigns, referenceTopology])

  const currentSignature =
    questionPackage && verificationInput
      ? computeVerificationSignature(questionPackage, verificationInput)
      : null
  const isStale = Boolean(report && currentSignature && report.signature !== currentSignature)

  const selectedDesign =
    selected.kind === 'gamed' ? gamedDesigns.find((d) => d.id === selected.id) : undefined
  const selectedTopology =
    selected.kind === 'reference' ? referenceTopology : selectedDesign?.topology
  const designKey = selected.kind === 'reference' ? 'reference' : `gamed-${selected.id}`

  const handleCanvasChange = (topology: TopologyJSON | undefined): void => {
    if (selected.kind === 'reference') {
      onReferenceChange(topology)
    } else {
      onGamedChange(
        gamedDesigns.map((design) => (design.id === selected.id ? { ...design, topology } : design))
      )
    }
  }

  const handleAddGamed = (): void => {
    const id = `gamed-${gamedDesigns.length + 1}`
    onGamedChange([
      ...gamedDesigns,
      { id, label: `Gamed design ${gamedDesigns.length + 1}`, misconception: '' }
    ])
    setSelected({ kind: 'gamed', id })
  }

  const handleRemoveGamed = (id: string): void => {
    onGamedChange(gamedDesigns.filter((design) => design.id !== id))
    if (selected.kind === 'gamed' && selected.id === id) setSelected({ kind: 'reference' })
  }

  const patchGamed = (id: string, changes: Partial<GamedTopologyDraft>): void => {
    onGamedChange(
      gamedDesigns.map((design) => (design.id === id ? { ...design, ...changes } : design))
    )
  }

  const handleSeedFromScaffold = (): void => {
    if (!scaffoldTopology) return
    if (selected.kind === 'reference') {
      onReferenceChange(scaffoldTopology)
    } else {
      patchGamed(selected.id, { topology: scaffoldTopology })
    }
  }

  const handleRun = async (): Promise<void> => {
    if (!questionPackage || !verificationInput) return
    setRunning(true)
    try {
      const { runQuestionAuthoringVerification } =
        await import('../../../../engine/analysis/questionAuthoringVerification')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const next = runQuestionAuthoringVerification(questionPackage, verificationInput)
      setReport(next)
      onVerification({
        signature: next.signature,
        ready: next.ready,
        blockers: next.blockers,
        generatedAt: next.generatedAt
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <section
      className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
      aria-labelledby="discrimination-lab-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
            Prove discrimination
          </p>
          <h3 id="discrimination-lab-title" className="mt-1 text-base font-semibold text-nss-text">
            Discrimination lab
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
            Build the reference design and at least one plausible wrong design. Verification runs
            the same grader and auto-router as production: the question is only publish-ready when
            the reference passes and every gamed design fails on its intended obligation.
          </p>
        </div>
        <button
          type="button"
          disabled={!canRun || running}
          onClick={() => void handleRun()}
          className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FlaskConical size={14} aria-hidden="true" />
          {running ? 'Running…' : 'Run verification'}
        </button>
      </div>

      {preview.status !== 'ready' && (
        <p className="mt-4 rounded-md border border-nss-warning/30 bg-nss-warning/10 px-3 py-2 text-[11px] text-nss-warning">
          Resolve the grading contract first — verification needs a question that compiles.
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Designs
          </p>
          <button
            type="button"
            onClick={() => setSelected({ kind: 'reference' })}
            className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-semibold ${
              selected.kind === 'reference'
                ? 'border-nss-primary/40 bg-nss-primary/10 text-nss-primary'
                : 'border-nss-border bg-nss-surface text-nss-text hover:border-nss-primary/30'
            }`}
          >
            Reference
            <span className="text-[10px] font-normal text-nss-muted">
              {referenceTopology ? `${referenceTopology.nodes.length}n` : 'empty'}
            </span>
          </button>
          {gamedDesigns.map((design) => (
            <div
              key={design.id}
              className={`flex items-center gap-1 rounded-md border px-2 py-1.5 ${
                selected.kind === 'gamed' && selected.id === design.id
                  ? 'border-nss-primary/40 bg-nss-primary/10'
                  : 'border-nss-border bg-nss-surface'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelected({ kind: 'gamed', id: design.id })}
                className="flex-1 truncate text-left text-xs font-semibold text-nss-text"
              >
                {design.label}
                <span className="block text-[10px] font-normal text-nss-muted">
                  {design.topology ? `${design.topology.nodes.length}n` : 'empty'}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${design.label}`}
                onClick={() => handleRemoveGamed(design.id)}
                className="flex h-6 w-6 items-center justify-center rounded text-nss-muted hover:bg-nss-danger/10 hover:text-nss-danger"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddGamed}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-nss-borderHigh px-3 py-2 text-[11px] font-semibold text-nss-muted hover:border-nss-primary/40 hover:text-nss-primary"
          >
            <Plus size={12} aria-hidden="true" />
            Add gamed design
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-nss-text">
              Editing: {selected.kind === 'reference' ? 'Reference' : (selectedDesign?.label ?? '')}
            </p>
            {scaffoldTopology && (
              <button
                type="button"
                onClick={handleSeedFromScaffold}
                className="rounded-md border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-muted hover:border-nss-primary/40 hover:text-nss-primary"
              >
                Seed from scaffold
              </button>
            )}
          </div>

          {selected.kind === 'gamed' && selectedDesign && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Misconception
                </span>
                <input
                  aria-label="Misconception"
                  value={selectedDesign.misconception}
                  onChange={(event) =>
                    patchGamed(selectedDesign.id, { misconception: event.currentTarget.value })
                  }
                  placeholder="e.g. cache is beside the API, not on the read path"
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Expected discriminator
                </span>
                <select
                  aria-label="Expected discriminator"
                  value={selectedDesign.expectedObligationId ?? ''}
                  onChange={(event) =>
                    patchGamed(selectedDesign.id, {
                      expectedObligationId: event.currentTarget.value || undefined
                    })
                  }
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                >
                  <option value="">No specific obligation</option>
                  {obligationOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} ({option.axis})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <AuthoringTopologyCanvas
            designKey={designKey}
            topology={selectedTopology}
            onTopologyChange={handleCanvasChange}
            defaultId={
              selected.kind === 'reference'
                ? `${questionId}-reference`
                : `${questionId}-${designKey}`
            }
            defaultName={
              selected.kind === 'reference'
                ? 'Reference design'
                : (selectedDesign?.label ?? 'Gamed design')
            }
          />
        </div>
      </div>

      {report && (
        <div className="mt-6">
          {isStale && (
            <p className="mb-3 flex items-center gap-1.5 rounded-md border border-nss-warning/30 bg-nss-warning/10 px-3 py-2 text-[11px] font-semibold text-nss-warning">
              <AlertTriangle size={13} aria-hidden="true" />
              Proof is stale — a design, scenario, or grading rule changed since this run. Re-run
              verification.
            </p>
          )}
          <div className="overflow-hidden rounded-lg border border-nss-border">
            <table className="w-full border-collapse text-left">
              <thead className="bg-nss-surface">
                <tr className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  <th className="px-3 py-2">Design</th>
                  <th className="px-3 py-2">Structural</th>
                  <th className="px-3 py-2">Semantic</th>
                  <th className="px-3 py-2">Rubric</th>
                  <th className="px-3 py-2">Expected</th>
                  <th className="px-3 py-2">Ready</th>
                </tr>
              </thead>
              <tbody>
                <MatrixRow design={report.reference} />
                {report.gamed.map((design) => (
                  <MatrixRow key={design.id} design={design} />
                ))}
              </tbody>
            </table>
          </div>

          <div
            className={`mt-3 rounded-md border px-3 py-2.5 ${
              report.ready
                ? 'border-nss-success/25 bg-nss-success/10'
                : 'border-nss-warning/30 bg-nss-warning/10'
            }`}
          >
            <p
              className={`text-[10px] font-semibold uppercase tracking-wide ${
                report.ready ? 'text-nss-success' : 'text-nss-warning'
              }`}
            >
              {report.ready ? 'Discrimination proven' : 'Not publish-ready'}
            </p>
            {report.ready ? (
              <p className="mt-1 text-xs text-nss-text">
                The reference passes and every gamed design is caught on its intended obligation.
              </p>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-nss-text">
                {report.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
