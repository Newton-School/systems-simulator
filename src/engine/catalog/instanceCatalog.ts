/**
 * The instance catalog — a fixed, curated menu of hardware SKUs authors pick
 * from, mirroring the AWS instance-family model. Per-instance vCPU/RAM/price are
 * NOT free-typed: an author selects an `InstanceType` and the engine resolves the
 * spec from here. This is what makes "resource allocation" physical — you can't
 * ask for 6.5 vCPU or infinite RAM, and getting more of one axis (e.g. RAM) means
 * taking a bigger instance that also costs more vCPU and more money.
 *
 * Curated, not the full AWS SKU list: three CPU:RAM ratio tiers (2/4/8 GB per
 * vCPU) plus a burstable floor and a memory-extreme ceiling, at 2/4/8-vCPU sizes
 * so scaling up (bigger type) and out (more instances) are both expressible.
 * Prices are AWS-proportional on-demand $/hr (us-east-1 order of magnitude) so the
 * relative tradeoffs are faithful — compute-optimized is cheaper per vCPU,
 * memory-optimized costs a premium per GB, x1e is deliberately expensive.
 *
 * See ns-simulator-docs/specs/resource-allocation-and-derived-concurrency.md.
 */

export type InstanceFamily =
  | 'burstable'
  | 'general'
  | 'compute-optimized'
  | 'memory-optimized'
  | 'memory-extreme'

export type InstanceType =
  | 't3.small'
  | 't3.medium'
  | 'm5.large'
  | 'm5.xlarge'
  | 'm5.2xlarge'
  | 'c5.large'
  | 'c5.xlarge'
  | 'c5.2xlarge'
  | 'r5.large'
  | 'r5.xlarge'
  | 'r5.2xlarge'
  | 'x1e.xlarge'

export interface InstanceSpec {
  /** Virtual CPUs per instance. */
  vcpu: number
  /** RAM per instance, in GB. */
  ramGb: number
  family: InstanceFamily
  /** On-demand price per instance-hour, in USD (AWS-proportional). */
  pricePerHour: number
  /**
   * Relative single-thread compute speed (CoreMark-inspired). Baseline general
   * (`m5`) = 1.0; compute-optimized (`c5`) is faster; burstable (`t3`) slower. A
   * faster instance serves each request in less time — "buy better hardware → lower
   * latency". Per-family (single-core speed is ~constant across sizes of a family).
   */
  perfFactor: number
}

/** The frozen menu. Keyed by `InstanceType`; resolved by the engine, never edited. */
export const INSTANCE_CATALOG: Readonly<Record<InstanceType, InstanceSpec>> = Object.freeze({
  't3.small': { vcpu: 2, ramGb: 2, family: 'burstable', pricePerHour: 0.021, perfFactor: 0.8 },
  't3.medium': { vcpu: 2, ramGb: 4, family: 'burstable', pricePerHour: 0.042, perfFactor: 0.8 },
  'm5.large': { vcpu: 2, ramGb: 8, family: 'general', pricePerHour: 0.096, perfFactor: 1.0 },
  'm5.xlarge': { vcpu: 4, ramGb: 16, family: 'general', pricePerHour: 0.192, perfFactor: 1.0 },
  'm5.2xlarge': { vcpu: 8, ramGb: 32, family: 'general', pricePerHour: 0.384, perfFactor: 1.0 },
  'c5.large': { vcpu: 2, ramGb: 4, family: 'compute-optimized', pricePerHour: 0.085, perfFactor: 1.3 },
  'c5.xlarge': { vcpu: 4, ramGb: 8, family: 'compute-optimized', pricePerHour: 0.17, perfFactor: 1.3 },
  'c5.2xlarge': { vcpu: 8, ramGb: 16, family: 'compute-optimized', pricePerHour: 0.34, perfFactor: 1.3 },
  'r5.large': { vcpu: 2, ramGb: 16, family: 'memory-optimized', pricePerHour: 0.126, perfFactor: 1.0 },
  'r5.xlarge': { vcpu: 4, ramGb: 32, family: 'memory-optimized', pricePerHour: 0.252, perfFactor: 1.0 },
  'r5.2xlarge': { vcpu: 8, ramGb: 64, family: 'memory-optimized', pricePerHour: 0.504, perfFactor: 1.0 },
  'x1e.xlarge': { vcpu: 4, ramGb: 122, family: 'memory-extreme', pricePerHour: 0.834, perfFactor: 1.0 }
})

/** All catalog keys, e.g. for building a zod enum or a palette dropdown. */
export const INSTANCE_TYPES = Object.keys(INSTANCE_CATALOG) as InstanceType[]

/** Type guard — whether an arbitrary string is a known instance type. */
export function isInstanceType(value: unknown): value is InstanceType {
  return typeof value === 'string' && value in INSTANCE_CATALOG
}

/** Resolve a spec, throwing on an unknown type (callers should validate first). */
export function resolveInstanceSpec(type: InstanceType): InstanceSpec {
  const spec = INSTANCE_CATALOG[type]
  if (!spec) {
    throw new Error(`Unknown instance type '${type}'. Expected one of: ${INSTANCE_TYPES.join(', ')}.`)
  }
  return spec
}

/**
 * Purchasing model — the flexibility ↔ commitment ↔ risk tradeoff on price
 * (inspired by AWS on-demand / reserved / spot). Cost is `pricePerHour ×
 * PRICING_MULTIPLIER[model] × instanceCount`.
 */
export type PricingModel = 'on-demand' | 'reserved' | 'spot'

export const PRICING_MODELS: readonly PricingModel[] = ['on-demand', 'reserved', 'spot']

/** Price multiplier per model (AWS-proportional): reserved ~40% off, spot ~70% off. */
export const PRICING_MULTIPLIER: Readonly<Record<PricingModel, number>> = Object.freeze({
  'on-demand': 1,
  reserved: 0.6,
  spot: 0.3
})

/** Resolve the price multiplier for a model (default on-demand). */
export function pricingMultiplier(model: PricingModel | undefined): number {
  return PRICING_MULTIPLIER[model ?? 'on-demand']
}
