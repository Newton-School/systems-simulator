import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const TOKEN_COST_COMPONENT_TYPES = [
  'llm-gateway'
] as const satisfies readonly ComponentType[]

const DEFAULT_MS_PER_TOKEN = 8
const DEFAULT_OUTPUT_TOKENS = 128

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function addPenalty(request: { metadata: Record<string, unknown> }, ms: number): void {
  const existing =
    typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
      ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
      : 0
  request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existing + ms
}

/**
 * LLM token-cost latency. Unlike a normal request, an LLM response's latency
 * scales with the number of output tokens generated (~ms per token), not with
 * request count. This gives AI-serving questions their defining cost model: a
 * chatty prompt is slow regardless of throughput.
 */
export const tokenCostTrait: NodeBehaviourTrait = {
  name: 'ai.token-cost',
  beforeArrival: ({ node, request }) => {
    const msPerToken = asNonNegativeNumber(node.config?.['msPerToken'])
    const outputTokens = asNonNegativeNumber(node.config?.['outputTokens'])
    if (msPerToken === null || outputTokens === null || msPerToken === 0 || outputTokens === 0) {
      return { action: 'continue' }
    }
    const penaltyMs = msPerToken * outputTokens
    addPenalty(request, penaltyMs)
    return {
      action: 'continue',
      payload: {
        tokenLatencyMs: penaltyMs,
        outputTokens,
        metricCounters: { llmCompletions: 1, tokensGenerated: outputTokens }
      }
    }
  }
}

export const tokenCostCapabilityModule: NodeCapabilityModule = {
  name: 'ai.token-cost',
  appliesTo: TOKEN_COST_COMPONENT_TYPES,
  hooks: tokenCostTrait,
  config: {
    sections: [
      {
        id: 'token-cost',
        title: 'Token Cost',
        note: 'LLM latency scales with output tokens (ms/token × tokens), not request count. Models why a chatty completion is slow independent of throughput.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.msPerToken',
            type: 'input',
            inputType: 'number',
            label: 'Latency per token',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_MS_PER_TOKEN}ms`,
            why: 'Time to generate each output token.'
          },
          {
            path: 'sim.outputTokens',
            type: 'input',
            inputType: 'number',
            label: 'Output tokens',
            unit: 'tokens',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_OUTPUT_TOKENS}`,
            why: 'Typical completion length; total added latency = ms/token × output tokens.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['llmCompletions', 'tokensGenerated'] },
  honesty: {
    simulates: ['per-request latency proportional to a configured output-token count'],
    notModeled: ['streaming token delivery, prompt-length input cost, or batching across requests']
  }
}
