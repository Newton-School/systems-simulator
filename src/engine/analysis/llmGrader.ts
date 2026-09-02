/**
 * Provider-agnostic LLM-backed justification grading.
 *
 * This module complements the deterministic grader in `justification.ts`. Where
 * the deterministic grader checks for exact keyword matches (graph-consistency,
 * number-citation, tradeoff tokens), an LLM is used to *semantically* evaluate
 * student justifications — understanding paraphrasing, synonyms, and natural
 * language nuance.
 *
 * The prompt and the structured response contract are identical across
 * providers. Each provider is a thin adapter that knows how to call its API and
 * extract the model's text; the shared core builds the prompt and parses the
 * JSON. Adding a provider means adding one entry to `PROVIDERS` — nothing else
 * in the pipeline changes.
 *
 * Architecture:
 *   Renderer  →  IPC (`llm:gradeJustification`)  →  Main process  →  <provider> API
 *
 * The API key lives exclusively in the main process; the renderer never sees
 * it. If the LLM call fails (network, rate-limit, timeout, no key), the caller
 * falls back to the deterministic grader so the student is never blocked.
 */

import type { JustifyPrompt } from './gradingCriteria'
import type { JustificationOutcome, JustificationResult } from './justification'

// ── Types ────────────────────────────────────────────────────────────────────

/** Input payload sent from the renderer to the main process over IPC. */
export interface LlmGradeRequest {
  /** The justify prompt definition (decision text, boundTo, requires, etc.). */
  prompt: JustifyPrompt
  /** The student's free-text answer. */
  studentAnswer: string
  /** The component type the student actually placed (undefined ⇒ absent). */
  actualComponentType: string | undefined
  /** Scale numbers from the question (for number-citation evaluation). */
  scaleNumbers: readonly number[]
}

/** Structured response contract every provider must return (as JSON). */
export interface LlmGradeResponse {
  outcome: 'passed' | 'partial' | 'failed'
  graphConsistent: boolean
  numberCitation: boolean
  tradeoffMentioned: boolean
  feedback: string
  confidence: number
}

/** Identifiers for the supported LLM back-ends. */
export type LlmProviderId = 'gemini' | 'anthropic' | 'openai'

/** Fully-resolved configuration for a single grading call. */
export interface LlmProviderConfig {
  providerId: LlmProviderId
  apiKey: string
  /** Model id; falls back to the provider's `defaultModel` when omitted. */
  model?: string
}

/**
 * A provider adapter. `grade` receives the resolved config and request and must
 * return a validated `LlmGradeResponse`, throwing on any failure so the caller
 * can fall back deterministically.
 */
export interface LlmProvider {
  id: LlmProviderId
  /** Model used when `LlmProviderConfig.model` is not supplied. */
  defaultModel: string
  /** Environment variables consulted (in order) to find this provider's key. */
  envKeys: readonly string[]
  grade: (config: LlmProviderConfig, request: LlmGradeRequest) => Promise<LlmGradeResponse>
}

// ── Prompt construction (shared across providers) ─────────────────────────────

/**
 * Builds the grading prompt for a single justification. The prompt instructs
 * the model to return a JSON object matching `LlmGradeResponse`. Temperature
 * should be kept low (≤ 0.1) for reproducibility.
 */
export function buildGradingPrompt(req: LlmGradeRequest): string {
  const componentLine =
    req.actualComponentType !== undefined
      ? `The student's design contains this component type: "${req.actualComponentType}".`
      : `The bound component is MISSING from the student’s design — graph-consistency MUST fail.`

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

// ── Response parsing (shared across providers) ────────────────────────────────

/**
 * Parses and validates the model's raw text into an `LlmGradeResponse`.
 * Tolerates accidental markdown fencing (```json … ```), which models sometimes
 * emit despite instructions.
 *
 * @throws When the text is empty, not JSON, or has an invalid `outcome`.
 */
export function parseLlmGradeResponse(text: string | undefined | null): LlmGradeResponse {
  if (!text || !text.trim()) {
    throw new Error('LLM returned an empty response.')
  }
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const parsed = JSON.parse(stripped) as LlmGradeResponse
  if (!['passed', 'partial', 'failed'].includes(parsed.outcome)) {
    throw new Error(`Unexpected outcome "${parsed.outcome}" from LLM.`)
  }
  return parsed
}

// ── Result mapping (shared across providers) ──────────────────────────────────

/**
 * Maps a provider response into the engine's `JustificationResult` so it can be
 * consumed by the existing UI and grading pipeline unchanged.
 */
export function mapLlmResponseToResult(
  promptId: string,
  response: LlmGradeResponse
): JustificationResult {
  const outcome: JustificationOutcome =
    response.outcome === 'passed' ? 'passed' : response.outcome === 'partial' ? 'partial' : 'failed'

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

// ── Provider adapters ─────────────────────────────────────────────────────────

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  return `${res.status}: ${body.slice(0, 200)}`
}

/** Google Gemini — structured JSON via `responseMimeType`. */
const geminiProvider: LlmProvider = {
  id: 'gemini',
  defaultModel: 'gemini-3.6-flash',
  envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  async grade(config, request) {
    const model = config.model ?? this.defaultModel
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildGradingPrompt(request) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      })
    })
    if (!res.ok) throw new Error(`Gemini API ${await readError(res)}`)
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    return parseLlmGradeResponse(data.candidates?.[0]?.content?.parts?.[0]?.text)
  }
}

/** Anthropic Claude — Messages API. */
const anthropicProvider: LlmProvider = {
  id: 'anthropic',
  defaultModel: 'claude-sonnet-5',
  envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  async grade(config, request) {
    const model = config.model ?? this.defaultModel
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature: 0.1,
        messages: [{ role: 'user', content: buildGradingPrompt(request) }]
      })
    })
    if (!res.ok) throw new Error(`Anthropic API ${await readError(res)}`)
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = data.content?.find((block) => block.type === 'text')?.text
    return parseLlmGradeResponse(text)
  }
}

/** OpenAI — Chat Completions with JSON response format. */
const openaiProvider: LlmProvider = {
  id: 'openai',
  defaultModel: 'gpt-4o-mini',
  envKeys: ['OPENAI_API_KEY'],
  async grade(config, request) {
    const model = config.model ?? this.defaultModel
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildGradingPrompt(request) }]
      })
    })
    if (!res.ok) throw new Error(`OpenAI API ${await readError(res)}`)
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return parseLlmGradeResponse(data.choices?.[0]?.message?.content)
  }
}

/** Registry of all supported providers, keyed by id. */
export const PROVIDERS: Record<LlmProviderId, LlmProvider> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider
}

// ── Configuration resolution (main-process only) ──────────────────────────────

/** A minimal env shape so this stays testable without `process`. */
export type EnvLike = Record<string, string | undefined>

function normalizeProviderId(raw: string | undefined): LlmProviderId | undefined {
  const value = raw?.trim().toLowerCase()
  if (value === 'gemini' || value === 'google') return 'gemini'
  if (value === 'anthropic' || value === 'claude') return 'anthropic'
  if (value === 'openai' || value === 'chatgpt' || value === 'gpt') return 'openai'
  return undefined
}

/**
 * Resolves which provider to use and its key from the environment.
 *
 * Selection order:
 *   1. `LLM_GRADER_PROVIDER` (or its alias `LLM_PROVIDER`) names a provider
 *      explicitly; its key is then read from that provider's `envKeys`.
 *   2. Otherwise, auto-detect: the first provider (gemini → anthropic → openai)
 *      that has any of its `envKeys` set wins.
 *
 * `LLM_GRADER_MODEL` (or `LLM_MODEL`) optionally overrides the model id.
 *
 * Returns `null` when no usable key is found — the renderer then falls back to
 * deterministic grading.
 */
export function resolveProviderConfig(env: EnvLike): LlmProviderConfig | null {
  const model = env['LLM_GRADER_MODEL']?.trim() || env['LLM_MODEL']?.trim() || undefined
  const explicit = normalizeProviderId(env['LLM_GRADER_PROVIDER'] ?? env['LLM_PROVIDER'])

  const keyFor = (provider: LlmProvider): string =>
    provider.envKeys.map((name) => env[name]?.trim()).find((value) => value) ?? ''

  if (explicit) {
    const provider = PROVIDERS[explicit]
    const apiKey = keyFor(provider)
    if (!apiKey) return null
    return { providerId: provider.id, apiKey, ...(model ? { model } : {}) }
  }

  for (const id of ['gemini', 'anthropic', 'openai'] as const) {
    const apiKey = keyFor(PROVIDERS[id])
    if (apiKey) return { providerId: id, apiKey, ...(model ? { model } : {}) }
  }
  return null
}

// ── Grading entry point (main-process only) ───────────────────────────────────

/**
 * Grades a justification with the configured provider. Intended to run in the
 * Electron main process (Node context with network access); the renderer
 * invokes it via IPC.
 *
 * @throws On unknown provider, network failure, non-2xx status, or unparseable
 *   response — the caller falls back to the deterministic grader.
 */
export async function callLlmGradeAPI(
  config: LlmProviderConfig,
  request: LlmGradeRequest
): Promise<LlmGradeResponse> {
  const provider = PROVIDERS[config.providerId]
  if (!provider) {
    throw new Error(`Unknown LLM provider "${config.providerId}".`)
  }
  return provider.grade(config, request)
}
