/**
 * The instance catalog — a fixed, curated menu of hardware SKUs authors pick
 * from, mirroring the AWS instance-family model. Per-instance vCPU/RAM/price are
 * NOT free-typed: an author selects an `InstanceType` and the engine resolves the
 * spec from here. This is what makes "resource allocation" physical — you can't
 * ask for 6.5 vCPU or infinite RAM, and getting more of one axis (e.g. RAM) means
 * taking a bigger instance that also costs more vCPU and more money.
 *
 * Four CPU:RAM ratio families (compute 2, general 4, memory 8, extreme ~30 GB per
 * vCPU) plus a burstable floor, each spanning the full AWS size ladder from
 * `large` up to `24xlarge` (2 → 96 vCPU). Because for an io-bound node the derived
 * throughput ceiling is `vcpu × IO_WORKERS_PER_VCPU ÷ service-time`, a dense vCPU
 * ladder makes *capacity itself a menu pick*: an author sizing a node to ~100k
 * req/s selects the SKU whose derived "THROUGHPUT CAPACITY" reads ~100k rather than
 * hand-tuning an opaque service-time constant. Scaling up (bigger type) and out
 * (more instances) are both expressible, and every rung is a real AWS SKU.
 *
 * Prices are AWS-proportional on-demand $/hr (us-east-1 order of magnitude), held
 * linear per vCPU within a family so the relative tradeoffs are faithful —
 * compute-optimized is cheaper per vCPU, memory-optimized costs a premium per GB,
 * x1e is deliberately expensive. perfFactor is per-family (single-core speed is
 * ~constant across sizes of a family).
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
  // Burstable (t3) — small/cheap floor.
  | 't3.small'
  | 't3.medium'
  | 't3.large'
  | 't3.xlarge'
  | 't3.2xlarge'
  // General purpose (m5) — 4 GB/vCPU.
  | 'm5.large'
  | 'm5.xlarge'
  | 'm5.2xlarge'
  | 'm5.4xlarge'
  | 'm5.8xlarge'
  | 'm5.12xlarge'
  | 'm5.16xlarge'
  | 'm5.24xlarge'
  // Compute optimized (c5) — 2 GB/vCPU, faster core.
  | 'c5.large'
  | 'c5.xlarge'
  | 'c5.2xlarge'
  | 'c5.4xlarge'
  | 'c5.9xlarge'
  | 'c5.12xlarge'
  | 'c5.18xlarge'
  | 'c5.24xlarge'
  // Memory optimized (r5) — 8 GB/vCPU.
  | 'r5.large'
  | 'r5.xlarge'
  | 'r5.2xlarge'
  | 'r5.4xlarge'
  | 'r5.8xlarge'
  | 'r5.12xlarge'
  | 'r5.16xlarge'
  | 'r5.24xlarge'
  // Memory extreme (x1e) — ~30 GB/vCPU, deliberately expensive.
  | 'x1e.xlarge'
  | 'x1e.2xlarge'
  | 'x1e.4xlarge'
  | 'x1e.8xlarge'
  | 'x1e.16xlarge'
  | 'x1e.32xlarge'

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
  // ── Burstable (t3) · perf 0.8 · ~0.021/vCpu·hr ──
  't3.small': { vcpu: 2, ramGb: 2, family: 'burstable', pricePerHour: 0.021, perfFactor: 0.8 },
  't3.medium': { vcpu: 2, ramGb: 4, family: 'burstable', pricePerHour: 0.042, perfFactor: 0.8 },
  't3.large': { vcpu: 2, ramGb: 8, family: 'burstable', pricePerHour: 0.084, perfFactor: 0.8 },
  't3.xlarge': { vcpu: 4, ramGb: 16, family: 'burstable', pricePerHour: 0.168, perfFactor: 0.8 },
  't3.2xlarge': { vcpu: 8, ramGb: 32, family: 'burstable', pricePerHour: 0.336, perfFactor: 0.8 },

  // ── General purpose (m5) · perf 1.0 · 4 GB/vCPU · 0.048/vCpu·hr ──
  'm5.large': { vcpu: 2, ramGb: 8, family: 'general', pricePerHour: 0.096, perfFactor: 1.0 },
  'm5.xlarge': { vcpu: 4, ramGb: 16, family: 'general', pricePerHour: 0.192, perfFactor: 1.0 },
  'm5.2xlarge': { vcpu: 8, ramGb: 32, family: 'general', pricePerHour: 0.384, perfFactor: 1.0 },
  'm5.4xlarge': { vcpu: 16, ramGb: 64, family: 'general', pricePerHour: 0.768, perfFactor: 1.0 },
  'm5.8xlarge': { vcpu: 32, ramGb: 128, family: 'general', pricePerHour: 1.536, perfFactor: 1.0 },
  'm5.12xlarge': { vcpu: 48, ramGb: 192, family: 'general', pricePerHour: 2.304, perfFactor: 1.0 },
  'm5.16xlarge': { vcpu: 64, ramGb: 256, family: 'general', pricePerHour: 3.072, perfFactor: 1.0 },
  'm5.24xlarge': { vcpu: 96, ramGb: 384, family: 'general', pricePerHour: 4.608, perfFactor: 1.0 },

  // ── Compute optimized (c5) · perf 1.3 · 2 GB/vCPU · 0.0425/vCpu·hr ──
  'c5.large': {
    vcpu: 2,
    ramGb: 4,
    family: 'compute-optimized',
    pricePerHour: 0.085,
    perfFactor: 1.3
  },
  'c5.xlarge': {
    vcpu: 4,
    ramGb: 8,
    family: 'compute-optimized',
    pricePerHour: 0.17,
    perfFactor: 1.3
  },
  'c5.2xlarge': {
    vcpu: 8,
    ramGb: 16,
    family: 'compute-optimized',
    pricePerHour: 0.34,
    perfFactor: 1.3
  },
  'c5.4xlarge': {
    vcpu: 16,
    ramGb: 32,
    family: 'compute-optimized',
    pricePerHour: 0.68,
    perfFactor: 1.3
  },
  'c5.9xlarge': {
    vcpu: 36,
    ramGb: 72,
    family: 'compute-optimized',
    pricePerHour: 1.53,
    perfFactor: 1.3
  },
  'c5.12xlarge': {
    vcpu: 48,
    ramGb: 96,
    family: 'compute-optimized',
    pricePerHour: 2.04,
    perfFactor: 1.3
  },
  'c5.18xlarge': {
    vcpu: 72,
    ramGb: 144,
    family: 'compute-optimized',
    pricePerHour: 3.06,
    perfFactor: 1.3
  },
  'c5.24xlarge': {
    vcpu: 96,
    ramGb: 192,
    family: 'compute-optimized',
    pricePerHour: 4.08,
    perfFactor: 1.3
  },

  // ── Memory optimized (r5) · perf 1.0 · 8 GB/vCPU · 0.063/vCpu·hr ──
  'r5.large': {
    vcpu: 2,
    ramGb: 16,
    family: 'memory-optimized',
    pricePerHour: 0.126,
    perfFactor: 1.0
  },
  'r5.xlarge': {
    vcpu: 4,
    ramGb: 32,
    family: 'memory-optimized',
    pricePerHour: 0.252,
    perfFactor: 1.0
  },
  'r5.2xlarge': {
    vcpu: 8,
    ramGb: 64,
    family: 'memory-optimized',
    pricePerHour: 0.504,
    perfFactor: 1.0
  },
  'r5.4xlarge': {
    vcpu: 16,
    ramGb: 128,
    family: 'memory-optimized',
    pricePerHour: 1.008,
    perfFactor: 1.0
  },
  'r5.8xlarge': {
    vcpu: 32,
    ramGb: 256,
    family: 'memory-optimized',
    pricePerHour: 2.016,
    perfFactor: 1.0
  },
  'r5.12xlarge': {
    vcpu: 48,
    ramGb: 384,
    family: 'memory-optimized',
    pricePerHour: 3.024,
    perfFactor: 1.0
  },
  'r5.16xlarge': {
    vcpu: 64,
    ramGb: 512,
    family: 'memory-optimized',
    pricePerHour: 4.032,
    perfFactor: 1.0
  },
  'r5.24xlarge': {
    vcpu: 96,
    ramGb: 768,
    family: 'memory-optimized',
    pricePerHour: 6.048,
    perfFactor: 1.0
  },

  // ── Memory extreme (x1e) · perf 1.0 · ~30 GB/vCPU · 0.2085/vCpu·hr (premium) ──
  'x1e.xlarge': {
    vcpu: 4,
    ramGb: 122,
    family: 'memory-extreme',
    pricePerHour: 0.834,
    perfFactor: 1.0
  },
  'x1e.2xlarge': {
    vcpu: 8,
    ramGb: 244,
    family: 'memory-extreme',
    pricePerHour: 1.668,
    perfFactor: 1.0
  },
  'x1e.4xlarge': {
    vcpu: 16,
    ramGb: 488,
    family: 'memory-extreme',
    pricePerHour: 3.336,
    perfFactor: 1.0
  },
  'x1e.8xlarge': {
    vcpu: 32,
    ramGb: 976,
    family: 'memory-extreme',
    pricePerHour: 6.672,
    perfFactor: 1.0
  },
  'x1e.16xlarge': {
    vcpu: 64,
    ramGb: 1952,
    family: 'memory-extreme',
    pricePerHour: 13.344,
    perfFactor: 1.0
  },
  'x1e.32xlarge': {
    vcpu: 128,
    ramGb: 3904,
    family: 'memory-extreme',
    pricePerHour: 26.688,
    perfFactor: 1.0
  }
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
    throw new Error(
      `Unknown instance type '${type}'. Expected one of: ${INSTANCE_TYPES.join(', ')}.`
    )
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
