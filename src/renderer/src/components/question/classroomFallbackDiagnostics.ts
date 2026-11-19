import type { EnvironmentProfile } from '../../../../engine/analysis/environmentProfile'

export function shouldWriteClassroomFallbackNotice({
  isDevelopment,
  mode,
  reason,
  questionId
}: {
  isDevelopment: boolean
  mode: EnvironmentProfile['mode']
  reason: string | null
  questionId: string | undefined
}): boolean {
  return isDevelopment && mode === 'AUTHOR' && Boolean(reason) && Boolean(questionId)
}
