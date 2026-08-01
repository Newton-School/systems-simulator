import {
  parseAttemptState,
  parseQuestionPackage,
  type AttemptState,
  type QuestionPackage
} from '../../../../engine/analysis/question'

export interface EmbeddedIframeQuestion {
  type: 'embedded-iframe'
  title?: string
  prompt?: string
  url: string
  height?: number
  allowFullscreen?: boolean
  allowedOrigins?: string[]
  questionPackage?: QuestionPackage
  priorAttempt?: AttemptState
}

export function parseEmbeddedIframeQuestion(input: string): {
  question: EmbeddedIframeQuestion | null
  error: string | null
} {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { question: null, error: null }
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<EmbeddedIframeQuestion> & {
      questionPackage?: unknown
      priorAttempt?: unknown
    }
    if (parsed.type !== 'embedded-iframe') {
      return { question: null, error: null }
    }

    if (typeof parsed.url !== 'string' || parsed.url.trim().length === 0) {
      return { question: null, error: 'Embedded iframe questions require a non-empty url.' }
    }

    let origin: URL
    try {
      origin = new URL(parsed.url)
    } catch {
      return { question: null, error: 'Embedded iframe question url must be a valid absolute URL.' }
    }

    if (!['http:', 'https:'].includes(origin.protocol)) {
      return { question: null, error: 'Embedded iframe question url must use http or https.' }
    }

    let questionPackage: QuestionPackage | undefined
    let priorAttempt: AttemptState | undefined
    try {
      questionPackage =
        parsed.questionPackage !== undefined
          ? parseQuestionPackage(parsed.questionPackage)
          : undefined
      priorAttempt =
        parsed.priorAttempt !== undefined && questionPackage
          ? parseAttemptState(parsed.priorAttempt, questionPackage.id)
          : undefined
    } catch (error) {
      return {
        question: null,
        error: (error as Error).message
      }
    }

    if (parsed.priorAttempt !== undefined && !questionPackage) {
      return {
        question: null,
        error: 'Embedded iframe priorAttempt requires a questionPackage.'
      }
    }

    return {
      question: {
        type: 'embedded-iframe',
        url: parsed.url,
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
        height:
          typeof parsed.height === 'number' && Number.isFinite(parsed.height) && parsed.height > 200
            ? parsed.height
            : 420,
        allowFullscreen: parsed.allowFullscreen !== false,
        allowedOrigins:
          Array.isArray(parsed.allowedOrigins) &&
          parsed.allowedOrigins.every((item) => typeof item === 'string')
            ? parsed.allowedOrigins
            : [origin.origin],
        ...(questionPackage ? { questionPackage } : {}),
        ...(priorAttempt ? { priorAttempt } : {})
      },
      error: null
    }
  } catch {
    return { question: null, error: null }
  }
}
