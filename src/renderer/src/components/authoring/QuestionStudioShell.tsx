import { ArrowRight, Braces, Layers3, Link2, Target } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compileQuestionAuthoringPreview } from '../../../../engine/analysis/questionAuthoringCompiler'
import {
  createQuestionAuthoringProject,
  resolveQuestionAuthoringSetup,
  touchQuestionAuthoringProject,
  updateQuestionAuthoringFunctionalRequirements,
  updateQuestionAuthoringMetricRules,
  updateQuestionAuthoringMetadata,
  updateQuestionAuthoringNonFunctionalRequirements,
  updateQuestionAuthoringPromptDetails,
  updateQuestionAuthoringProblemStatement,
  updateQuestionAuthoringScaffoldTopology,
  updateQuestionAuthoringGamedTopologies,
  updateQuestionAuthoringReferenceTopology,
  updateQuestionAuthoringRubricChecks,
  updateQuestionAuthoringScenarios,
  updateQuestionAuthoringSemanticRules,
  updateQuestionAuthoringStage,
  updateQuestionAuthoringStructuralRules,
  updateQuestionAuthoringTitle,
  updateQuestionAuthoringSetup,
  updateQuestionAuthoringDryRunScenario,
  updateQuestionAuthoringJustifyPrompts,
  updateQuestionAuthoringScaffoldContract,
  updateQuestionAuthoringVerification,
  type QuestionAuthoringVerificationProof,
  type GamedTopologyDraft
} from '../../../../engine/analysis/questionAuthoringProject'
import {
  nonFunctionalRequirementReducer,
  type NonFunctionalRequirementAction
} from '../../../../engine/analysis/questionAuthoringNfr'
import {
  functionalRequirementReducer,
  type FunctionalRequirementAction
} from '../../../../engine/analysis/questionAuthoringRequirements'
import {
  authoringScenarioReducer,
  compileAuthoringScenario,
  type AuthoringScenarioAction
} from '../../../../engine/analysis/questionAuthoringScenario'
import {
  authoringStructuralRuleReducer,
  getAuthoringStructuralRuleCapability,
  type AuthoringStructuralRuleAction
} from '../../../../engine/analysis/questionAuthoringStructuralRules'
import {
  authoringMetricRuleReducer,
  type AuthoringMetricRuleAction
} from '../../../../engine/analysis/questionAuthoringMetricRules'
import {
  authoringSemanticRuleReducer,
  getAuthoringSemanticRuleCapability,
  type AuthoringSemanticRuleAction
} from '../../../../engine/analysis/questionAuthoringSemanticRules'
import { getAuthoringMetricRuleCapability } from '../../../../engine/analysis/questionAuthoringMetricRules'
import {
  authoringRubricCheckReducer,
  type AuthoringRubricCheckAction
} from '../../../../engine/analysis/questionAuthoringRubricChecks'
import { getRubricMetricCapability } from '../../../../engine/analysis/authoringCapabilities'
import type { TopologyJSON } from '../../../../engine/core/types'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'
import { FileService } from '../../services/FileService'
import type { IFileService } from '../../services/FileService.types'
import { downloadQuestionAuthoringArtifacts } from '../../services/questionArtifactExport'
import {
  openQuestionAuthoringProject,
  saveQuestionAuthoringProject
} from '../../services/questionProjectPersistence'
import { AuthoringHeader, type AuthoringFileStatus } from './AuthoringHeader'
import { SettingsModal } from '../layout/settings/SettingsModal'
import { AuthoringReadinessPanel } from './AuthoringReadinessPanel'
import { AuthoringStageRail } from './AuthoringStageRail'
import { GeneratedOutputPreview } from './GeneratedOutputPreview'
import { LessonFrameEditor } from './LessonFrameEditor'
import { LearnerStartEditor } from './LearnerStartEditor'
import { LearnerExperiencePreview } from './LearnerExperiencePreview'
import { MetricGradingEditor } from './MetricGradingEditor'
import { DiscriminationLab, type ObligationOption } from './DiscriminationLab'
import { QuestionBriefEditor } from './QuestionBriefEditor'
import { QuestionConstraintsEditor } from './QuestionConstraintsEditor'
import { QuestionSetupEditor } from './QuestionSetupEditor'
import { QuestionMetadataEditor } from './QuestionMetadataEditor'
import { PromptDetailsEditor } from './PromptDetailsEditor'
import { ScaffoldContractEditor } from './ScaffoldContractEditor'
import { JustificationEditor } from './JustificationEditor'
import { RubricCheckEditor } from './RubricCheckEditor'
import { ScenarioSuiteEditor } from './ScenarioSuiteEditor'
import { SemanticGradingEditor } from './SemanticGradingEditor'
import { StructuralGradingEditor } from './StructuralGradingEditor'
import {
  getQuestionStudioStage,
  QUESTION_STUDIO_STAGES,
  type AuthoringStageId
} from './questionStudioStages'

interface QuestionStudioShellProps {
  simulatorHref?: string
  fileService?: IFileService
}

const FRAME_PREVIEW = [
  {
    icon: Target,
    title: 'Teaching intent',
    description: 'State what the learner should understand and which plausible mistake must fail.'
  },
  {
    icon: Layers3,
    title: 'Question identity',
    description: 'Add a title, stable ID, difficulty, domain, and learner entry format.'
  },
  {
    icon: Link2,
    title: 'Traceability',
    description: 'Every gradeable requirement will link to a real engine obligation.'
  }
] as const

export function QuestionStudioShell({
  simulatorHref = './',
  fileService = FileService
}: QuestionStudioShellProps): React.JSX.Element {
  const [project, setProject] = useState(createQuestionAuthoringProject)
  const [isDirty, setIsDirty] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [operation, setOperation] = useState<'idle' | 'saving' | 'opening' | 'exporting'>('idle')
  const [capturingBaseline, setCapturingBaseline] = useState(false)
  const [fileError, setFileError] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const editRevisionRef = useRef(0)
  const { confirm, dialog } = useConfirmDialog()
  const activeStage = project.ui.activeStage
  const questionTitle = project.question.title
  const problemStatement = project.question.prompt.text
  const functionalRequirements = project.question.prompt.functionalRequirements
  const nonFunctionalRequirements = project.question.prompt.nonFunctionalRequirements
  const scenarios = project.question.scenarios
  const structuralRules = project.question.structuralRules
  const semanticRules = project.question.semanticRules
  const metricRules = project.question.metricRules
  const rubricChecks = project.question.rubricChecks
  const setup = resolveQuestionAuthoringSetup(project.question.setup)
  const scaffoldTopology = project.assets.scaffoldTopology
  const referenceTopology = project.assets.referenceTopology
  const gamedDesigns = project.assets.gamedTopologies
  const obligationOptions = useMemo<ObligationOption[]>(() => {
    const options: ObligationOption[] = []
    for (const rule of structuralRules) {
      options.push({
        id: rule.id,
        label: getAuthoringStructuralRuleCapability(rule.kind).label,
        axis: 'structural'
      })
    }
    for (const rule of semanticRules) {
      options.push({
        id: rule.id,
        label: getAuthoringSemanticRuleCapability(rule.kind).label,
        axis: 'semantic'
      })
    }
    for (const rule of metricRules) {
      options.push({
        id: rule.id,
        label: getAuthoringMetricRuleCapability(rule.metric).label,
        axis: 'rubric'
      })
    }
    for (const check of rubricChecks) {
      options.push({
        id: check.id,
        label: getRubricMetricCapability(check.metric)?.label ?? check.metric,
        axis: 'rubric'
      })
    }
    return options
  }, [metricRules, rubricChecks, semanticRules, structuralRules])
  const stage = getQuestionStudioStage(activeStage)
  const nextStage = QUESTION_STUDIO_STAGES[stage.number]
  const generatedPreview = useMemo(() => compileQuestionAuthoringPreview(project), [project])
  const canExport = generatedPreview.status === 'ready'
  const hasQuestionIdentity = questionTitle.trim().length > 0
  const hasLearnerBrief = problemStatement.trim().length > 0
  const hasScenario = scenarios.some((scenario) => compileAuthoringScenario(scenario) !== null)
  const hasGrading =
    structuralRules.length + semanticRules.length + metricRules.length + rubricChecks.length > 0
  const fileStatus: AuthoringFileStatus =
    operation === 'saving'
      ? 'saving'
      : operation === 'opening'
        ? 'opening'
        : fileError
          ? 'error'
          : isDirty
            ? 'unsaved'
            : fileName
              ? 'saved'
              : 'new'

  const handleTitleChange = useCallback((title: string) => {
    editRevisionRef.current += 1
    setProject((current) => updateQuestionAuthoringTitle(current, title))
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleSetupChange = useCallback(
    (nextSetup: Parameters<typeof updateQuestionAuthoringSetup>[1]) => {
      editRevisionRef.current += 1
      setProject((current) => updateQuestionAuthoringSetup(current, nextSetup))
      setIsDirty(true)
      setFileError(false)
      setNotice(null)
    },
    []
  )

  const handleMetadataChange = useCallback(
    (metadata: Parameters<typeof updateQuestionAuthoringMetadata>[1]) => {
      editRevisionRef.current += 1
      setProject((current) => updateQuestionAuthoringMetadata(current, metadata))
      setIsDirty(true)
      setFileError(false)
      setNotice(null)
    },
    []
  )

  const handlePromptDetailsChange = useCallback(
    (details: Parameters<typeof updateQuestionAuthoringPromptDetails>[1]) => {
      editRevisionRef.current += 1
      setProject((current) => updateQuestionAuthoringPromptDetails(current, details))
      setIsDirty(true)
      setFileError(false)
      setNotice(null)
    },
    []
  )

  const handleDryRunChange = useCallback((scenarioId: string | undefined) => {
    editRevisionRef.current += 1
    setProject((current) => updateQuestionAuthoringDryRunScenario(current, scenarioId))
    setIsDirty(true)
    setNotice(null)
  }, [])

  const handleJustifyChange = useCallback(
    (prompts: Parameters<typeof updateQuestionAuthoringJustifyPrompts>[1]) => {
      editRevisionRef.current += 1
      setProject((current) => updateQuestionAuthoringJustifyPrompts(current, prompts))
      setIsDirty(true)
      setNotice(null)
    },
    []
  )

  const handleScaffoldContractChange = useCallback(
    (contract: Parameters<typeof updateQuestionAuthoringScaffoldContract>[1]) => {
      editRevisionRef.current += 1
      setProject((current) => updateQuestionAuthoringScaffoldContract(current, contract))
      setIsDirty(true)
      setNotice(null)
    },
    []
  )

  const handleStageChange = useCallback((nextStage: AuthoringStageId) => {
    editRevisionRef.current += 1
    setProject((current) => updateQuestionAuthoringStage(current, nextStage))
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleProblemStatementChange = useCallback((text: string) => {
    editRevisionRef.current += 1
    setProject((current) => updateQuestionAuthoringProblemStatement(current, text))
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleFunctionalRequirementAction = useCallback((action: FunctionalRequirementAction) => {
    editRevisionRef.current += 1
    setProject((current) =>
      updateQuestionAuthoringFunctionalRequirements(
        current,
        functionalRequirementReducer(current.question.prompt.functionalRequirements, action)
      )
    )
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleNonFunctionalRequirementAction = useCallback(
    (action: NonFunctionalRequirementAction) => {
      editRevisionRef.current += 1
      setProject((current) =>
        updateQuestionAuthoringNonFunctionalRequirements(
          current,
          nonFunctionalRequirementReducer(current.question.prompt.nonFunctionalRequirements, action)
        )
      )
      setIsDirty(true)
      setFileError(false)
      setNotice(null)
    },
    []
  )

  const handleScenarioAction = useCallback((action: AuthoringScenarioAction) => {
    editRevisionRef.current += 1
    setProject((current) =>
      updateQuestionAuthoringScenarios(
        current,
        authoringScenarioReducer(current.question.scenarios, action)
      )
    )
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleScaffoldTopologyChange = useCallback(
    (topology: Parameters<typeof updateQuestionAuthoringScaffoldTopology>[1]) => {
      editRevisionRef.current += 1
      setProject((current) => updateQuestionAuthoringScaffoldTopology(current, topology))
      setIsDirty(true)
      setFileError(false)
      setNotice(null)
    },
    []
  )

  const handleCaptureBaseline = useCallback(async (): Promise<void> => {
    const scenario = scenarios.map(compileAuthoringScenario).find((value) => value !== null)
    if (!scaffoldTopology || !scenario) return
    setCapturingBaseline(true)
    setNotice(null)
    try {
      const [{ mergeTopologyWithOverrides }, { runSimulation }, { projectToVerdict }] =
        await Promise.all([
          import('../../../../engine/analysis/evaluate'),
          import('../../../../engine/runSimulation'),
          import('../../../../engine/analysis/verdict')
        ])
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const output = runSimulation(mergeTopologyWithOverrides(scaffoldTopology, scenario))
      const baselineVerdict = projectToVerdict(output)
      handleScaffoldContractChange({
        lockedNodeIds: project.assets.lockedNodeIds,
        lockedEdgeIds: project.assets.lockedEdgeIds,
        baselineVerdict
      })
      setNotice({ tone: 'success', message: 'Captured the current scaffold baseline.' })
    } catch (error) {
      console.error('[QuestionStudio] Baseline capture failed:', error)
      setNotice({ tone: 'error', message: 'Could not run the current scaffold as a baseline.' })
    } finally {
      setCapturingBaseline(false)
    }
  }, [handleScaffoldContractChange, project.assets, scaffoldTopology, scenarios])

  const handleRubricCheckAction = useCallback((action: AuthoringRubricCheckAction) => {
    editRevisionRef.current += 1
    setProject((current) =>
      updateQuestionAuthoringRubricChecks(
        current,
        authoringRubricCheckReducer(current.question.rubricChecks, action)
      )
    )
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleReferenceTopologyChange = useCallback((topology: TopologyJSON | undefined) => {
    editRevisionRef.current += 1
    setProject((current) => updateQuestionAuthoringReferenceTopology(current, topology))
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleGamedChange = useCallback((designs: GamedTopologyDraft[]) => {
    editRevisionRef.current += 1
    setProject((current) => updateQuestionAuthoringGamedTopologies(current, designs))
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleVerification = useCallback((proof: QuestionAuthoringVerificationProof) => {
    editRevisionRef.current += 1
    setProject((current) => updateQuestionAuthoringVerification(current, proof))
    setIsDirty(true)
    setFileError(false)
    setNotice({
      tone: proof.ready ? 'success' : 'error',
      message: proof.ready
        ? 'Verification passed. This proof is now stored with the project.'
        : `Verification found ${proof.blockers.length} publish blocker${proof.blockers.length === 1 ? '' : 's'}.`
    })
  }, [])

  const handleStructuralRuleAction = useCallback((action: AuthoringStructuralRuleAction) => {
    editRevisionRef.current += 1
    setProject((current) =>
      updateQuestionAuthoringStructuralRules(
        current,
        authoringStructuralRuleReducer(current.question.structuralRules, action)
      )
    )
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleSemanticRuleAction = useCallback((action: AuthoringSemanticRuleAction) => {
    editRevisionRef.current += 1
    setProject((current) =>
      updateQuestionAuthoringSemanticRules(
        current,
        authoringSemanticRuleReducer(current.question.semanticRules, action)
      )
    )
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleMetricRuleAction = useCallback((action: AuthoringMetricRuleAction) => {
    editRevisionRef.current += 1
    setProject((current) =>
      updateQuestionAuthoringMetricRules(
        current,
        authoringMetricRuleReducer(current.question.metricRules, action)
      )
    )
    setIsDirty(true)
    setFileError(false)
    setNotice(null)
  }, [])

  const handleSaveProject = useCallback(async () => {
    const projectToSave = touchQuestionAuthoringProject(project)
    const revisionAtSave = editRevisionRef.current
    setOperation('saving')
    setFileError(false)
    setNotice(null)

    const result = await saveQuestionAuthoringProject(projectToSave, fileService)
    setOperation('idle')

    if (result.status === 'saved') {
      const hasNewerEdits = editRevisionRef.current !== revisionAtSave
      if (!hasNewerEdits) setProject(projectToSave)
      setFileName(result.fileName)
      setIsDirty(hasNewerEdits)
      setNotice({
        tone: 'success',
        message: hasNewerEdits
          ? `Saved ${result.fileName}; newer edits remain unsaved.`
          : `Saved ${result.fileName}`
      })
    } else if (result.status === 'error') {
      setFileError(true)
      setNotice({ tone: 'error', message: result.message })
    }
  }, [fileService, project])

  const handleNewProject = useCallback(async (): Promise<void> => {
    if (isDirty) {
      const shouldDiscard = await confirm({
        title: 'Start a new question?',
        description:
          'Discard the current unsaved edits and start with a blank Question Studio project?',
        confirmLabel: 'Start New',
        cancelLabel: 'Keep Editing'
      })
      if (!shouldDiscard) return
    }
    editRevisionRef.current += 1
    setProject(createQuestionAuthoringProject())
    setFileName(null)
    setIsDirty(false)
    setFileError(false)
    setNotice({ tone: 'success', message: 'Started a new question project.' })
  }, [confirm, isDirty])

  const handleOpenProject = useCallback(async () => {
    if (isDirty) {
      const shouldDiscard = await confirm({
        title: 'Discard unsaved question changes?',
        description: 'Open another Question Studio project and lose the current unsaved edits?',
        confirmLabel: 'Discard and Open',
        cancelLabel: 'Keep Editing'
      })
      if (!shouldDiscard) return
    }

    setOperation('opening')
    setFileError(false)
    setNotice(null)
    const result = await openQuestionAuthoringProject(fileService)
    setOperation('idle')

    if (result.status === 'opened') {
      editRevisionRef.current += 1
      setProject(result.project)
      setFileName(result.fileName)
      setIsDirty(false)
      setNotice({ tone: 'success', message: `Opened ${result.fileName}` })
    } else if (result.status === 'error') {
      setFileError(true)
      setNotice({ tone: 'error', message: result.message })
    }
  }, [confirm, fileService, isDirty])

  const handleDownloadArtifacts = useCallback(async () => {
    setOperation('exporting')
    setFileError(false)
    setNotice(null)
    const result = await downloadQuestionAuthoringArtifacts(project, fileService)
    setOperation('idle')

    if (result.status === 'downloaded') {
      const verification = result.bundle.verification
      setNotice({
        tone: 'success',
        message: `Downloaded ${result.fileName}. Django fields, ordered test-case rows, the runtime package, and the admin guide are included.${verification.status === 'passed' ? ' Stored verification is current.' : ''}`
      })
    } else if (result.status === 'blocked' || result.status === 'error') {
      setFileError(true)
      setNotice({ tone: 'error', message: result.message })
    }
  }, [fileService, project])

  const handleDownloadQuestionPackage = useCallback(async () => {
    if (generatedPreview.status !== 'ready') return
    setFileError(false)
    setNotice(null)
    try {
      const saved = await fileService.save(
        generatedPreview.packageJson,
        `${generatedPreview.questionPackage.id}.question.json`,
        {
          dialogTitle: 'Download Question Package',
          fileDescription: 'Simulator Question Packages',
          saveAsNewFile: true
        }
      )
      if (saved) {
        setNotice({
          tone: 'success',
          message: `Downloaded ${saved.name}. Load it in the simulator with “Load question (.json)…”.`
        })
      }
    } catch (error) {
      console.error('[QuestionStudio] Question package download failed:', error)
      setFileError(true)
      setNotice({ tone: 'error', message: 'Could not download the question package.' })
    }
  }, [fileService, generatedPreview])

  useEffect(() => {
    if (!isDirty || typeof window.nssimulator?.onCloseRequest === 'function') return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    const onCloseRequest = window.nssimulator?.onCloseRequest
    if (typeof onCloseRequest !== 'function') return
    return onCloseRequest(() => isDirty)
  }, [isDirty])

  return (
    <div className="nss-app-shell nss-selectable-surface flex min-h-0 flex-col bg-nss-bg text-nss-text">
      <AuthoringHeader
        simulatorHref={simulatorHref}
        questionTitle={questionTitle}
        fileStatus={fileStatus}
        onNew={() => void handleNewProject()}
        onOpen={() => void handleOpenProject()}
        onPreviewLearner={() => handleStageChange('preview')}
        onSave={() => void handleSaveProject()}
        canExport={canExport}
        isExporting={operation === 'exporting'}
        onExport={() => void handleDownloadArtifacts()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[13.5rem_minmax(0,1fr)_16rem] max-[900px]:grid-cols-[11rem_minmax(0,1fr)] max-[680px]:grid-cols-1">
        <div className="max-[680px]:hidden">
          <AuthoringStageRail activeStage={activeStage} onStageChange={handleStageChange} />
        </div>

        <main className="min-h-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-8 lg:px-10">
            {notice && (
              <div
                role={notice.tone === 'error' ? 'alert' : 'status'}
                className={`mb-5 rounded-lg border px-3 py-2 text-xs ${
                  notice.tone === 'error'
                    ? 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger'
                    : 'border-nss-success/30 bg-nss-success/10 text-nss-success'
                }`}
              >
                {notice.message}
              </div>
            )}
            <label className="mb-6 hidden text-xs font-medium text-nss-muted max-[680px]:block">
              Authoring stage
              <select
                value={activeStage}
                onChange={(event) => handleStageChange(event.target.value as AuthoringStageId)}
                className="mt-2 block w-full rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-sm text-nss-text"
              >
                {QUESTION_STUDIO_STAGES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number}. {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-nss-primary">
                  Stage {stage.number} of {QUESTION_STUDIO_STAGES.length}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-nss-text">
                  {stage.id === 'frame' ? 'Frame the lesson' : stage.label}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-nss-muted">
                  {stage.id === 'frame'
                    ? 'Start with the learner-facing title. Its package ID is generated by the same rule used by the Newton row runtime.'
                    : stage.id === 'brief'
                      ? 'Write the learner-facing challenge in plain language and check the exact generated presentation beside it.'
                      : stage.id === 'start'
                        ? 'Draw the topology learners receive at the start. Valid canvas changes are stored directly in the authoring project.'
                        : stage.id === 'scenarios'
                          ? 'Create the repeatable workload every learner design will be evaluated against.'
                          : stage.id === 'grading'
                            ? 'Express grading obligations with controlled sentences backed by engine contracts.'
                            : stage.id === 'preview'
                              ? 'Review the exact compiled prompt, entry contract, scaffold summary, and learner-visible test access.'
                              : stage.id === 'export'
                                ? 'Inspect the exact runtime package and Newton rows generated from the current visual draft.'
                                : `${stage.shortDescription} is visible in the navigation shell and will be enabled incrementally.`}
                </p>
              </div>
              <span className="hidden rounded-full border border-nss-border bg-nss-panel px-3 py-1 text-[11px] font-medium text-nss-muted md:inline-flex">
                Project file ready
              </span>
            </div>

            {stage.id === 'frame' ? (
              <div className="mt-8">
                <LessonFrameEditor title={questionTitle} onTitleChange={handleTitleChange} />
                <div className="mt-4">
                  <QuestionSetupEditor
                    setup={setup}
                    hasScaffold={Boolean(scaffoldTopology?.nodes.length)}
                    onChange={handleSetupChange}
                  />
                </div>
                <div className="mt-4">
                  <QuestionMetadataEditor
                    metadata={{
                      description: project.question.description,
                      tags: project.question.tags,
                      author: project.question.author,
                      createdAt: project.question.createdAt
                    }}
                    onChange={handleMetadataChange}
                  />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {FRAME_PREVIEW.map((item) => {
                    const Icon = item.icon
                    return (
                      <article
                        key={item.title}
                        className="rounded-xl border border-nss-border bg-nss-panel p-4 shadow-sm"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-nss-primary/10 text-nss-primary">
                          <Icon size={17} aria-hidden="true" />
                        </span>
                        <h3 className="mt-4 text-sm font-semibold text-nss-text">{item.title}</h3>
                        <p className="mt-1.5 text-xs leading-5 text-nss-muted">
                          {item.description}
                        </p>
                      </article>
                    )
                  })}
                </div>
              </div>
            ) : stage.id === 'brief' ? (
              <div className="mt-8">
                <QuestionBriefEditor
                  questionTitle={questionTitle}
                  problemStatement={problemStatement}
                  functionalRequirements={functionalRequirements}
                  nonFunctionalRequirements={nonFunctionalRequirements}
                  additionalContext={project.question.prompt.additionalContext}
                  scale={project.question.prompt.scale}
                  onProblemStatementChange={handleProblemStatementChange}
                  onFunctionalRequirementAction={handleFunctionalRequirementAction}
                  onNonFunctionalRequirementAction={handleNonFunctionalRequirementAction}
                />
                <div className="mt-4">
                  <PromptDetailsEditor
                    additionalContext={project.question.prompt.additionalContext}
                    scale={project.question.prompt.scale}
                    onChange={handlePromptDetailsChange}
                  />
                </div>
              </div>
            ) : stage.id === 'start' ? (
              <div className="mt-8">
                <LearnerStartEditor
                  questionId={project.question.id}
                  questionTitle={questionTitle}
                  topology={scaffoldTopology}
                  onTopologyChange={handleScaffoldTopologyChange}
                />
                <div className="mt-4">
                  <QuestionConstraintsEditor setup={setup} onChange={handleSetupChange} />
                </div>
                <div className="mt-4">
                  <ScaffoldContractEditor
                    topology={scaffoldTopology}
                    contract={{
                      lockedNodeIds: project.assets.lockedNodeIds,
                      lockedEdgeIds: project.assets.lockedEdgeIds,
                      baselineVerdict: project.assets.baselineVerdict
                    }}
                    canCaptureBaseline={Boolean(
                      scaffoldTopology &&
                      scenarios.some((scenario) => compileAuthoringScenario(scenario))
                    )}
                    capturingBaseline={capturingBaseline}
                    onChange={handleScaffoldContractChange}
                    onCaptureBaseline={() => void handleCaptureBaseline()}
                  />
                </div>
              </div>
            ) : stage.id === 'scenarios' ? (
              <div className="mt-8">
                <ScenarioSuiteEditor
                  scenarios={scenarios}
                  dryRunScenarioId={project.question.dryRunScenarioId}
                  onAction={handleScenarioAction}
                  onDryRunChange={handleDryRunChange}
                />
              </div>
            ) : stage.id === 'grading' ? (
              <div className="mt-8 space-y-4">
                <StructuralGradingEditor
                  rules={structuralRules}
                  onAction={handleStructuralRuleAction}
                />
                <SemanticGradingEditor rules={semanticRules} onAction={handleSemanticRuleAction} />
                <MetricGradingEditor rules={metricRules} onAction={handleMetricRuleAction} />
                <RubricCheckEditor checks={rubricChecks} onAction={handleRubricCheckAction} />
                <JustificationEditor
                  prompts={project.question.justify}
                  onChange={handleJustifyChange}
                />
              </div>
            ) : stage.id === 'prove' ? (
              <div className="mt-8">
                <DiscriminationLab
                  questionId={project.question.id}
                  preview={generatedPreview}
                  referenceTopology={referenceTopology}
                  gamedDesigns={gamedDesigns}
                  obligationOptions={obligationOptions}
                  scaffoldTopology={scaffoldTopology}
                  onReferenceChange={handleReferenceTopologyChange}
                  onGamedChange={handleGamedChange}
                  onVerification={handleVerification}
                />
              </div>
            ) : stage.id === 'preview' ? (
              <div className="mt-8">
                <LearnerExperiencePreview preview={generatedPreview} />
              </div>
            ) : stage.id === 'export' ? (
              <div className="mt-8">
                <GeneratedOutputPreview
                  preview={generatedPreview}
                  onNavigate={handleStageChange}
                  onDownload={handleDownloadArtifacts}
                  onDownloadQuestion={handleDownloadQuestionPackage}
                />
              </div>
            ) : (
              <div className="mt-8 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-nss-borderHigh bg-nss-panel px-6 text-center">
                <Braces size={24} className="text-nss-muted" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold text-nss-text">Stage placeholder</h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-nss-muted">
                  The shell and navigation are active. This editor arrives in its own testable
                  checkpoint.
                </p>
              </div>
            )}

            <div className="mt-auto pt-10">
              <div className="flex items-center justify-between rounded-xl border border-nss-border bg-nss-panel px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-nss-text">Question Studio</p>
                  <p className="mt-0.5 text-[11px] text-nss-muted">
                    Your draft is saved as one project and compiled into the runtime question rows.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!nextStage}
                  onClick={() => nextStage && handleStageChange(nextStage.id)}
                  className="flex items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {nextStage ? `Continue to ${nextStage.label}` : 'Finish review'}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </main>

        <AuthoringReadinessPanel
          hasQuestionIdentity={hasQuestionIdentity}
          hasLearnerBrief={hasLearnerBrief}
          hasScenario={hasScenario}
          hasGrading={hasGrading}
        />
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {dialog}
    </div>
  )
}
