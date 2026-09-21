import { buildDjangoQuestionExport, type DjangoQuestionExport } from './djangoQuestionExport'
import {
  compileQuestionAuthoringPreview,
  type QuestionAuthoringPreviewDiagnostic
} from './questionAuthoringCompiler'
import {
  parseQuestionAuthoringProject,
  type QuestionAuthoringProject
} from './questionAuthoringProject'
import type { QuestionPackage } from './question'
import type { QuestionAuthoringVerificationInput } from './questionAuthoringVerification'
import { computeVerificationSignature } from './questionAuthoringVerificationSignature'

export const QUESTION_AUTHORING_EXPORT_BUNDLE_ARTIFACT = 'dsds-question-export-bundle' as const
export const QUESTION_AUTHORING_EXPORT_BUNDLE_VERSION = '1.0' as const
export const QUESTION_AUTHORING_EXPORT_BUNDLE_FILE_SUFFIX =
  '.dsds-question-export-bundle.json' as const

export interface QuestionAuthoringExportBundle {
  artifact: typeof QUESTION_AUTHORING_EXPORT_BUNDLE_ARTIFACT
  artifactVersion: typeof QUESTION_AUTHORING_EXPORT_BUNDLE_VERSION
  authoringProject: QuestionAuthoringProject
  questionPackage: QuestionPackage
  django: DjangoQuestionExport
  verification:
    | { status: 'not-run'; publishReady: false; message: string }
    | { status: 'stale'; publishReady: false; message: string; generatedAt: string }
    | {
        status: 'passed' | 'failed'
        publishReady: boolean
        message: string
        generatedAt: string
        blockers: string[]
      }
}

export type CompiledQuestionAuthoringExportBundle =
  | {
      status: 'blocked'
      diagnostics: QuestionAuthoringPreviewDiagnostic[]
    }
  | {
      status: 'ready'
      bundle: QuestionAuthoringExportBundle
      content: string
      fileName: string
    }

const UNVERIFIED_MESSAGE = 'Draft handoff only. Reference and gamed designs have not been verified.'

function cloneProject(project: QuestionAuthoringProject): QuestionAuthoringProject {
  return parseQuestionAuthoringProject(JSON.parse(JSON.stringify(project)) as unknown)
}

function compileVerificationStatus(
  project: QuestionAuthoringProject,
  questionPackage: QuestionPackage
): QuestionAuthoringExportBundle['verification'] {
  const proof = project.verification
  if (!proof) {
    return { status: 'not-run', publishReady: false, message: UNVERIFIED_MESSAGE }
  }
  const reference = project.assets.referenceTopology
  const gamed = project.assets.gamedTopologies
  if (!reference || gamed.some((design) => !design.topology)) {
    return {
      status: 'stale',
      publishReady: false,
      message: 'Stored verification is stale because its proof designs changed.',
      generatedAt: proof.generatedAt
    }
  }
  const input: QuestionAuthoringVerificationInput = {
    reference: { id: 'reference', label: 'Reference', topology: reference },
    gamed: gamed.map((design) => ({
      id: design.id,
      label: design.label,
      topology: design.topology!,
      ...(design.misconception ? { misconception: design.misconception } : {}),
      ...(design.expectedObligationId ? { expectedObligationId: design.expectedObligationId } : {})
    }))
  }
  const currentSignature = computeVerificationSignature(questionPackage, input)
  if (currentSignature !== proof.signature) {
    return {
      status: 'stale',
      publishReady: false,
      message: 'Stored verification is stale because the question or proof designs changed.',
      generatedAt: proof.generatedAt
    }
  }
  return {
    status: proof.ready ? 'passed' : 'failed',
    publishReady: proof.ready,
    message: proof.ready
      ? 'Reference and gamed designs passed the discrimination proof.'
      : 'Verification ran, but the question still has publish blockers.',
    generatedAt: proof.generatedAt,
    blockers: [...proof.blockers]
  }
}

export function compileQuestionAuthoringExportBundle(
  project: QuestionAuthoringProject
): CompiledQuestionAuthoringExportBundle {
  const preview = compileQuestionAuthoringPreview(project)
  if (preview.status === 'blocked') {
    return preview
  }

  const bundle: QuestionAuthoringExportBundle = {
    artifact: QUESTION_AUTHORING_EXPORT_BUNDLE_ARTIFACT,
    artifactVersion: QUESTION_AUTHORING_EXPORT_BUNDLE_VERSION,
    authoringProject: cloneProject(project),
    questionPackage: preview.questionPackage,
    django: buildDjangoQuestionExport(preview.questionPackage, preview.compiledRows),
    verification: compileVerificationStatus(project, preview.questionPackage)
  }

  return {
    status: 'ready',
    bundle,
    content: `${JSON.stringify(bundle, null, 2)}\n`,
    fileName: `${preview.questionPackage.id}${QUESTION_AUTHORING_EXPORT_BUNDLE_FILE_SUFFIX}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])])
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function parseQuestionAuthoringExportBundle(input: unknown): QuestionAuthoringExportBundle {
  if (
    !isRecord(input) ||
    input.artifact !== QUESTION_AUTHORING_EXPORT_BUNDLE_ARTIFACT ||
    input.artifactVersion !== QUESTION_AUTHORING_EXPORT_BUNDLE_VERSION
  ) {
    throw new Error('Expected a DSDS Question Studio export bundle 1.0.')
  }

  const project = parseQuestionAuthoringProject(input.authoringProject)
  const rebuilt = compileQuestionAuthoringExportBundle(project)
  if (rebuilt.status !== 'ready') {
    throw new Error('The bundled authoring project no longer compiles.')
  }
  if (canonicalJson(input) !== canonicalJson(rebuilt.bundle)) {
    throw new Error('The export bundle does not match its embedded authoring project.')
  }

  return rebuilt.bundle
}

export function deserializeQuestionAuthoringExportBundle(
  content: string
): QuestionAuthoringExportBundle {
  return parseQuestionAuthoringExportBundle(JSON.parse(content) as unknown)
}
