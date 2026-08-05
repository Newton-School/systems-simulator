/**
 * Graph-consistent justification grading (Phase 2) — the anti-gaming linchpin.
 *
 * The faculty demand a first-class, gradeable justification. We grade it
 * *structurally against the graph*, deterministically, with no LLM:
 *
 *   1. Graph-consistency (the anti-stuffing gate): the answer must reference the
 *      component the student *actually placed* for this decision. You cannot
 *      write a correct-sounding justification for a graph you didn't build — if
 *      the bound choice is absent, or the answer only names a different store,
 *      the justification fails outright.
 *   2. Number-citation: the answer must cite a number this question defines
 *      (anti-memorization — a reference answer's prose won't fit randomized scale).
 *   3. Tradeoff: the answer must state what is given up.
 *
 * The engine stays pure: the caller injects graph/catalog/scale lookups via
 * `JustificationContext`, so this module is fully unit-testable with no DOM,
 * store, or catalog dependency.
 */
import type { ComponentType } from '../core/types'
import type { JustifyPrompt } from './gradingCriteria'

export interface JustificationAnswer {
  promptId: string
  text: string
}

export interface JustificationContext {
  /**
   * The component type the student actually placed for a prompt's binding,
   * resolved from the graph (undefined ⇒ the bound choice is absent from the
   * graph — a graph-consistency failure).
   */
  resolveBoundType: (boundTo: JustifyPrompt['boundTo']) => ComponentType | undefined
  /** Aliases/labels for a component type (from the catalog) for mention detection. */
  aliasesOf: (type: ComponentType) => readonly string[]
  /** The numbers this question defines (scale + NFR targets), for number-citation. */
  scaleNumbers: readonly number[]
}

export type JustificationOutcome = 'passed' | 'partial' | 'failed' | 'missing'

export interface JustificationResult {
  promptId: string
  outcome: JustificationOutcome
  pointsEarned: number
  pointsPossible: number
  checks: {
    /** Did the answer reference the component actually in the graph? (the gate) */
    graphConsistent?: boolean
    number?: boolean
    tradeoff?: boolean
  }
  detail?: string
}

/** Words that signal a tradeoff when a prompt provides no explicit token list. */
const DEFAULT_TRADEOFF_TOKENS: readonly string[] = [
  'tradeoff',
  'trade-off',
  'but',
  'however',
  'lose',
  'lost',
  'give up',
  'giving up',
  'at the cost',
  'sacrifice',
  'downside',
  'cannot',
  "can't",
  'no longer',
  'instead of',
  'accept'
]

function normalize(text: string): string {
  return text.toLowerCase().trim()
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase()
  return needles.some((needle) => needle.length > 0 && lower.includes(needle.toLowerCase()))
}

/**
 * Extracts numeric magnitudes from prose, expanding k/m/b/thousand-style suffixes
 * so "200K" matches a scale number of 200000.
 */
export function extractNumbers(text: string): number[] {
  const out: number[] = []
  // A k/m/b multiplier only counts as a standalone token (word boundary after
  // it), so "5ms" stays 5 (latency) rather than becoming 5 million.
  const re = /(\d+(?:\.\d+)?)(?:\s*(k|m|b|thousand|million|billion)\b)?/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const base = Number.parseFloat(match[1])
    if (!Number.isFinite(base)) continue
    const suffix = (match[2] ?? '').toLowerCase()
    const factor =
      suffix === 'k' || suffix === 'thousand'
        ? 1_000
        : suffix === 'm' || suffix === 'million'
          ? 1_000_000
          : suffix === 'b' || suffix === 'billion'
            ? 1_000_000_000
            : 1
    out.push(base * factor)
  }
  return out
}

function citesAScaleNumber(text: string, scaleNumbers: readonly number[]): boolean {
  if (scaleNumbers.length === 0) return false
  const answerNumbers = extractNumbers(text)
  return answerNumbers.some((a) =>
    scaleNumbers.some((s) => {
      if (s === 0) return a === 0
      // exact, or within 0.5% to tolerate rounding ("~1.25M" vs 1_250_000).
      return Math.abs(a - s) / Math.abs(s) <= 0.005
    })
  )
}

/** An answer that is empty or merely echoes the decision prompt is a non-answer. */
function isNonAnswer(text: string, decision: string): boolean {
  const t = normalize(text)
  if (t.length === 0) return true
  const d = normalize(decision)
  return t === d || (d.length > 0 && d.includes(t))
}

export function gradeJustification(
  prompt: JustifyPrompt,
  answer: JustificationAnswer | undefined,
  ctx: JustificationContext
): JustificationResult {
  const pointsPossible = 0 // points live on the criterion, not the prompt; see gradeJustifications
  const text = answer?.text ?? ''

  if (isNonAnswer(text, prompt.decision)) {
    return {
      promptId: prompt.id,
      outcome: 'missing',
      pointsEarned: 0,
      pointsPossible,
      checks: {},
      detail: 'No justification provided.'
    }
  }

  // 1. Graph-consistency gate (only when the prompt requires a choice).
  let graphConsistent: boolean | undefined
  if (prompt.requires.choice) {
    const boundType = ctx.resolveBoundType(prompt.boundTo)
    if (boundType === undefined) {
      return {
        promptId: prompt.id,
        outcome: 'failed',
        pointsEarned: 0,
        pointsPossible,
        checks: { graphConsistent: false },
        detail: 'The design does not contain the component this justification is about.'
      }
    }
    graphConsistent = containsAny(text, ctx.aliasesOf(boundType))
    if (!graphConsistent) {
      return {
        promptId: prompt.id,
        outcome: 'failed',
        pointsEarned: 0,
        pointsPossible,
        checks: { graphConsistent: false },
        detail: 'The justification does not reference the component actually in the design.'
      }
    }
  }

  // 2 & 3. Graded credit: number-citation and tradeoff.
  const checks: JustificationResult['checks'] = { graphConsistent }
  const required: boolean[] = []

  if (prompt.requires.number) {
    checks.number = citesAScaleNumber(text, ctx.scaleNumbers)
    required.push(checks.number)
  }
  const tradeoffTokens =
    prompt.acceptTradeoffTokens && prompt.acceptTradeoffTokens.length > 0
      ? prompt.acceptTradeoffTokens
      : DEFAULT_TRADEOFF_TOKENS
  if (prompt.requires.tradeoff) {
    checks.tradeoff = containsAny(text, tradeoffTokens)
    required.push(checks.tradeoff)
  }

  const met = required.filter(Boolean).length
  const outcome: JustificationOutcome =
    required.length === 0 || met === required.length ? 'passed' : met === 0 ? 'failed' : 'partial'

  return { promptId: prompt.id, outcome, pointsEarned: 0, pointsPossible, checks }
}

export interface JustificationBatchResult {
  results: JustificationResult[]
  pointsEarned: number
  pointsPossible: number
}

/**
 * Grades every prompt and allocates points. Each prompt's points come from
 * `pointsByPromptId` (authored on the paired grading criterion). A `passed`
 * prompt earns full points; `partial` earns a proportional share of the met
 * graded checks; `failed`/`missing` earn nothing.
 */
export function gradeJustifications(
  prompts: readonly JustifyPrompt[],
  answers: readonly JustificationAnswer[],
  ctx: JustificationContext,
  pointsByPromptId: Readonly<Record<string, number>>
): JustificationBatchResult {
  const answerById = new Map(answers.map((a) => [a.promptId, a]))
  let pointsEarned = 0
  let pointsPossible = 0

  const results = prompts.map((prompt) => {
    const points = pointsByPromptId[prompt.id] ?? 0
    pointsPossible += points

    const result = gradeJustification(prompt, answerById.get(prompt.id), ctx)
    let earned = 0
    if (result.outcome === 'passed') {
      earned = points
    } else if (result.outcome === 'partial') {
      const graded = [result.checks.number, result.checks.tradeoff].filter(
        (v) => v !== undefined
      ) as boolean[]
      const met = graded.filter(Boolean).length
      earned = graded.length > 0 ? Math.floor((points * met) / graded.length) : 0
    }
    pointsEarned += earned
    return { ...result, pointsEarned: earned, pointsPossible: points }
  })

  return { results, pointsEarned, pointsPossible }
}
