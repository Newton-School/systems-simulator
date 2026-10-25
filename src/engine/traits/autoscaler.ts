import { getInstanceCount, type ComponentNode, type ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const AUTOSCALER_COMPONENT_TYPES = [
  'microservice',
  'serverless-function'
] as const satisfies readonly ComponentType[]

const DEFAULT_TARGET_UTILIZATION = 0.7
const DEFAULT_COOLDOWN_MS = 5000
const DEFAULT_STEP = 1
const CURRENT_INSTANCES_KEY = 'autoscaler.currentInstances'
const RECOMMENDATIONS_KEY = 'autoscaler.recommendations'

// Kubernetes HPA defaults (chapter 14 section 2): 15 s sync, 10% tolerance, a 300 s scale-down stabilization
// window, scale-up by at most max(100% of replicas, 4 pods) per period.
const HPA_SYNC_PERIOD_MS = 15_000
const HPA_TOLERANCE = 0.1
const HPA_SCALE_DOWN_WINDOW_MS = 300_000
const HPA_SCALE_UP_MIN_PODS = 4

type Recommendation = { atUs: bigint; desired: number }

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function bounds(config: Record<string, unknown> | undefined): { min: number; max: number } | null {
  const max = asPositiveNumber(config?.['autoscaleMaxInstances'])
  if (max === null) {
    return null
  }
  const min = asPositiveNumber(config?.['autoscaleMinInstances']) ?? 1
  return { min: Math.round(min), max: Math.round(max) }
}

/**
 * Horizontal autoscaler — a control loop on the `onTick` recurring timer. Every
 * `autoscaleCooldownMs` it samples the node's live utilization — which under the
 * two-tier model is the CPU-inclusive headline (`max(worker, CPU)` occupancy), so
 * a compute-heavy node that pins its cores while its worker pool looks idle now
 * correctly triggers scale-out — and steps the instance count toward a target
 * band, bounded by min/max. The engine applies
 * the new instance count by resizing the node's effective concurrency
 * (`scaleInstancesTo`), so capacity genuinely follows demand — with the
 * reaction lag of one cooldown, the real autoscaling tradeoff. Scaling still
 * costs money (derived concurrency is priced), so it can't dodge the budget.
 */
export const autoscalerTrait: NodeBehaviourTrait = {
  name: 'compute.autoscaler',
  tickIntervalMs: (node: ComponentNode) => {
    if (!bounds(node.config)) {
      return null
    }
    return (
      asPositiveNumber(node.config?.['autoscaleCooldownMs']) ??
      (node.config?.['autoscalePolicy'] === 'hpa' ? HPA_SYNC_PERIOD_MS : DEFAULT_COOLDOWN_MS)
    )
  },
  onTick: ({ node, state, nodeState, clock }) => {
    const b = bounds(node.config)
    if (!b) {
      return
    }
    const target =
      asPositiveNumber(node.config?.['autoscaleTargetUtilization']) ?? DEFAULT_TARGET_UTILIZATION
    const step = asPositiveNumber(node.config?.['autoscaleStep']) ?? DEFAULT_STEP
    const util = nodeState?.utilization ?? 0

    const store: TraitStateStore | undefined = state
    const current =
      store?.get<number>(CURRENT_INSTANCES_KEY) ??
      clamp(getInstanceCount(node.resources), b.min, b.max)

    let next = current
    let scaledUp = 0
    let scaledDown = 0
    if (node.config?.['autoscalePolicy'] === 'hpa') {
      // The proportional rule: desired = ceil(current x observed / target), inside a 10% tolerance band
      // nothing happens, scale-up is rate limited, and scale-down takes the highest recommendation of the
      // stabilization window so a brief dip removes nothing.
      const ratio = util / target
      const rawDesired =
        Math.abs(ratio - 1) <= HPA_TOLERANCE ? current : Math.max(1, Math.ceil(current * ratio))
      // Before the first sync the fleet was running at its current size, which counts as the first recommendation.
      const history = store?.get<Recommendation[]>(RECOMMENDATIONS_KEY) ?? [
        { atUs: clock, desired: current }
      ]
      history.push({ atUs: clock, desired: rawDesired })
      const windowMs =
        asPositiveNumber(node.config?.['autoscaleScaleDownWindowMs']) ?? HPA_SCALE_DOWN_WINDOW_MS
      const windowStart = clock - BigInt(Math.round(windowMs * 1000))
      while (history.length > 1 && history[0].atUs < windowStart) history.shift()
      store?.set(RECOMMENDATIONS_KEY, history)
      let desired = rawDesired
      if (rawDesired < current) {
        desired = Math.max(...history.map((r) => r.desired))
      }
      if (desired > current) {
        const limit = current + Math.max(current, HPA_SCALE_UP_MIN_PODS)
        next = clamp(Math.min(desired, limit), b.min, b.max)
        scaledUp = next > current ? 1 : 0
      } else if (desired < current) {
        next = clamp(desired, b.min, b.max)
        scaledDown = next < current ? 1 : 0
      }
    } else if (util > target && current < b.max) {
      next = clamp(current + step, b.min, b.max)
      scaledUp = 1
    } else if (util < target * 0.5 && current > b.min) {
      // Scale down only well below target (hysteresis) so it doesn't flap.
      next = clamp(current - step, b.min, b.max)
      scaledDown = 1
    }
    store?.set(CURRENT_INSTANCES_KEY, next)

    return {
      scaleInstancesTo: next,
      utilizationObserved: util,
      metricCounters: {
        ...(scaledUp ? { autoscaleUps: 1 } : {}),
        ...(scaledDown ? { autoscaleDowns: 1 } : {})
      }
    }
  }
}

export const autoscalerCapabilityModule: NodeCapabilityModule = {
  name: 'compute.autoscaler',
  appliesTo: AUTOSCALER_COMPONENT_TYPES,
  hooks: autoscalerTrait,
  config: {
    sections: [
      {
        id: 'autoscaler',
        title: 'Autoscaling',
        note: 'Scales instance count toward a target utilization every cooldown — capacity follows demand with a real reaction lag. Set the max to enable it. Scaling still costs money.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.autoscaleMaxInstances',
            type: 'input',
            inputType: 'number',
            label: 'Max instances',
            min: 1,
            altitude: 'primary',
            why: 'Upper bound the autoscaler may grow to. Setting this enables autoscaling.'
          },
          {
            path: 'sim.autoscaleMinInstances',
            type: 'input',
            inputType: 'number',
            label: 'Min instances',
            min: 1,
            altitude: 'primary',
            placeholder: 'Default 1',
            why: 'Lower bound the autoscaler may shrink to.'
          },
          {
            path: 'sim.autoscaleTargetUtilization',
            type: 'input',
            inputType: 'number',
            label: 'Target utilization',
            unit: 'fraction',
            min: 0,
            max: 1,
            step: 0.05,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_TARGET_UTILIZATION}`,
            why: 'Scale up above this; scale down well below it (hysteresis avoids flapping). Utilization is CPU-inclusive: a core-pinned node scales out even if its worker pool looks idle.'
          },
          {
            path: 'sim.autoscaleCooldownMs',
            type: 'input',
            inputType: 'number',
            label: 'Cooldown',
            unit: 'ms',
            min: 1,
            altitude: 'advanced',
            placeholder: `Default ${DEFAULT_COOLDOWN_MS}ms`,
            why: 'How often the loop evaluates — also the reaction lag before capacity changes.'
          },
          {
            path: 'sim.autoscalePolicy',
            type: 'select',
            label: 'Policy',
            options: ['step', 'hpa'],
            altitude: 'advanced',
            why: "'step' adds or removes a fixed number of instances per cooldown. 'hpa' follows the Kubernetes rule: desired = ceil(current x utilization / target), a 10% tolerance, fast scale-up and a 300 s scale-down window; its sync period defaults to 15 s."
          },
          {
            path: 'sim.autoscaleScaleDownWindowMs',
            type: 'input',
            inputType: 'number',
            label: 'Scale-down window',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            placeholder: `Default ${HPA_SCALE_DOWN_WINDOW_MS}ms`,
            why: 'HPA policy only: scale-down uses the highest recommendation within this window.'
          },
          {
            path: 'sim.autoscaleStep',
            type: 'input',
            inputType: 'number',
            label: 'Step',
            unit: 'instances',
            min: 1,
            altitude: 'advanced',
            placeholder: `Default ${DEFAULT_STEP}`,
            why: 'Instances added/removed per scaling action.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['autoscaleUps', 'autoscaleDowns'] },
  honesty: {
    simulates: [
      'a utilization-target control loop that resizes effective concurrency every cooldown (reaction-lagged), bounded by min/max',
      "the Kubernetes HPA rule under autoscalePolicy 'hpa': ceil(current x utilization / target), 10% tolerance, rate-limited scale-up, 300 s scale-down window"
    ],
    notModeled: [
      'predictive/scheduled scaling, per-instance warm-up cost on scale-up (compose with coldStart), or cluster-level bin-packing'
    ]
  }
}
