/**
 * LLM-backed justification grading via Google Gemini Flash.
 *
 * This module complements the deterministic grader in `justification.ts`. Where
 * the deterministic grader checks for exact keyword matches (graph-consistency,
 * number-citation, tradeoff tokens), this module uses Gemini to *semantically*
 * evaluate student justifications — understanding paraphrasing, synonyms, and
 * natural language nuance.
 *
 * Architecture:
 *   Renderer  →  IPC (`gemini:gradeJustification`)  →  Main process  →  Gemini API
 *
 * The API key lives exclusively in the main process; the renderer never sees it.
 * If the LLM call fails (network, rate-limit, timeout), the caller should fall
 * back to the deterministic grader so the student is never blocked.
 */

import type { JustifyPrompt } from './gradingCriteria'
import type { JustificationOutcome, JustificationResult } from './justification'

// ── Types ────────────────────────────────────────────────────────────────────

/** Input payload sent from the renderer to the main process over IPC. */
export interface GeminiGradeRequest {
  /** The justify prompt definition (decision text, boundTo, requires, etc.). */
  prompt: JustifyPrompt
  /** The student's free-text answer. */
  studentAnswer: string
  /** The component type the student actually placed (undefined ⇒ absent). */
  actualComponentType: string | undefined
  /** Scale numbers from the question (for number-citation evaluation). */
  scaleNumbers: readonly number[]
}

/** Structured response expected from Gemini (via `responseMimeType: application/json`). */
export interface GeminiGradeResponse {
  outcome: 'passed' | 'partial' | 'failed'
  graphConsistent: boolean
  numberCitation: boolean
  tradeoffMentioned: boolean
  feedback: string
  confidence: number
}

// ── Prompt construction ──────────────────────────────────────────────────────

/**
 * Builds the system-style grading prompt for a single justification. The prompt
 * instructs Gemini to return a structured JSON object matching
 * `GeminiGradeResponse`. Temperature should be kept ≤ 0.1 for reproducibility.
 */
export function buildGeminiGradingPrompt(req: GeminiGradeRequest): string {
  const componentLine =
    req.actualComponentType !== undefined
      ? `The student's design contains this component type: "${req.actualComponentType}".`
      : `The bound component is MISSING from the student\u2019s design \u2014 graph-consistency MUST fail.`

  const scaleLine =
    req.scaleNumbers.length > 0
      ? `Scale numbers for this question: ${req.scaleNumbers.join(', ')}.`
      : 'No specific scale numbers are defined for this question.'

  return `You are grading a system design justification in an educational simulator.

## Decision to Justify
"${req.prompt.decision}"

## Student's Answer
"${req.studentAnswer}"

## Design Context
- ${componentLine}
- ${scaleLine}

## Grading Criteria
1. **Graph Consistency** (the anti-stuffing gate): The answer must reference the component the student *actually placed* in their design. If the bound component is missing from the design, this criterion MUST fail regardless of the answer content.
2. **Number Citation**: The answer should cite relevant scale numbers (e.g., "200K users", "50ms latency", "1 billion records") to demonstrate awareness of the problem's constraints. Accept reasonable rounding and abbreviations (200K = 200,000).
3. **Tradeoff Awareness**: The answer should acknowledge what is sacrificed, lost, or given up by choosing this approach. Synonyms and paraphrasing count — do NOT require the literal word "tradeoff".

## Response Format
Respond with ONLY a JSON object, no markdown fencing:
{
  "outcome": "passed" | "partial" | "failed",
  "graphConsistent": true | false,
  "numberCitation": true | false,
  "tradeoffMentioned": true | false,
  "feedback": "Concise, constructive feedback for the student (1-2 sentences max)",
  "confidence": 0.0 to 1.0
}

## Scoring Rules
- "passed" = graph-consistent AND at least one of (numberCitation, tradeoffMentioned) is met, OR all three met
- "partial" = graph-consistent but NEITHER number citation NOR tradeoff is mentioned
- "failed" = NOT graph-consistent, OR the answer is empty/nonsensical/irrelevant
- Be generous with synonyms, paraphrasing, and implicit tradeoffs
- A blank or near-blank answer is always "failed"`
}

// ── Response mapping ─────────────────────────────────────────────────────────

/**
 * Maps a raw Gemini response into the engine's `JustificationResult` so it can
 * be consumed by the existing UI and grading pipeline unchanged.
 */
export function mapGeminiResponseToResult(
  promptId: string,
  response: GeminiGradeResponse
): JustificationResult {
  const outcome: JustificationOutcome =
    response.outcome === 'passed'
      ? 'passed'
      : response.outcome === 'partial'
        ? 'partial'
        : 'failed'

  return {
    promptId,
    outcome,
    pointsEarned: 0, // Points are allocated by the batch grader, not per-prompt.
    pointsPossible: 0,
    checks: {
      graphConsistent: response.graphConsistent,
      number: response.numberCitation,
      tradeoff: response.tradeoffMentioned
    },
    detail: response.feedback
  }
}

// ── Gemini API call (main-process only) ──────────────────────────────────────

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent'

/**
 * Calls the Gemini Flash API to grade a justification. This function is
 * intended to run **only in the Electron main process** (Node.js context with
 * network access). The renderer should invoke this via IPC.
 *
 * @throws On network failure, non-2xx status, or unparseable response.
 */
export async function callGeminiGradeAPI(
  apiKey: string,
  request: GeminiGradeRequest
): Promise<GeminiGradeResponse> {
  const prompt = buildGeminiGradingPrompt(request)

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('Gemini returned an empty response (no candidate text).')
  }

  const parsed = JSON.parse(text) as GeminiGradeResponse

  // Minimal validation — trust the structured output but guard against garbage.
  if (!['passed', 'partial', 'failed'].includes(parsed.outcome)) {
    throw new Error(`Unexpected outcome "${parsed.outcome}" from Gemini.`)
  }

  return parsed
}
