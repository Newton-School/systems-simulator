/**
 * Authoring validator (Phase 1) — the "is this question authored correctly?" gate.
 *
 * `parseQuestionPackage` checks the *schema*; this checks the *authoring
 * contract* (question-simulation-alignment.md §10): does the question actually
 * grade what its prompt claims? It is a pure function of the `QuestionPackage`,
 * run at author time (Django admin `clean()` / CI), NOT at grade time. It catches
 * the exact mistakes the bank validation surfaced — wrong metric keys, scale
 * numbers that are printed but never injected, orphan NFRs, correctness questions
 * leaning on the simulation, dangling justify bindings, and missing `sizeBytes`.
 *
 * `error` diagnostics should block a save; `warning`s are advisory.
 */
import type { QuestionPackage } from './question'
import { inferRubricCheckKind } from './rubric'

export type AuthoringLevel = 'error' | 'warning'

export interface AuthoringDiagnostic {
  level: AuthoringLevel
  code: string
  message: string
  path?: string
}

/** Known-good verdict metric leaves for `simulation` checks. */
const SIMULATION_METRICS = new Set<string>([
  'summary.latency.p50',
  'summary.latency.p90',
  'summary.latency.p95',
  'summary.latency.p99',
  'summary.latency.min',
  'summary.latency.max',
  'summary.latency.mean',
  'summary.errorRate',
  'summary.throughput',
  'summary.totalRequests',
  'summary.successfulRequests',
  'summary.failedRequests',
  'perNode.maxUtilization',
  'perNode.maxErrorRate',
  'perNode.maxLatencyP99'
])

/** Known-good invariant metric keys. */
const INVARIANT_METRICS = new Set<string>([
  'invariantViolations.count',
  'sloBreaches.count',
  'conservation.unbalanced',
  'littlesLaw.violations'
])

/** NFR `metric` enum → the verdict metric a rubric check should use. */
const NFR_TO_VERDICT: Record<string, string> = {
  latency_p99: 'summary.latency.p99',
  latency_p50: 'summary.latency.p50',
  error_rate: 'summary.errorRate',
  throughput: 'summary.throughput'
  // `availability` has no direct verdict metric (≈ 1 - errorRate) — handled below.
}

function err(code: string, message: string, path?: string): AuthoringDiagnostic {
  return { level: 'error', code, message, ...(path ? { path } : {}) }
}
function warn(code: string, message: string, path?: string): AuthoringDiagnostic {
  return { level: 'warning', code, message, ...(path ? { path } : {}) }
}

function validateMetric(
  metric: string,
  kind: ReturnType<typeof inferRubricCheckKind>,
  path: string,
  out: AuthoringDiagnostic[]
): void {
  // The single most common mistake (bank finding): a made-up latency key.
  if (metric !== 'summary.latency.p99' && /latencyp99ms|latency_p99|p99ms/i.test(metric)) {
    out.push(
      err('metric.badLatencyKey', `"${metric}" does not resolve — use "summary.latency.p99".`, path)
    )
    return
  }

  if (kind === 'topology') {
    if (!metric.startsWith('topology.')) {
      out.push(
        err(
          'metric.kindMismatch',
          `topology check must use a "topology.*" metric, got "${metric}".`,
          path
        )
      )
    }
    return
  }
  if (kind === 'invariant') {
    if (
      !INVARIANT_METRICS.has(metric) &&
      !/^(invariantViolations|conservation|littlesLaw)\./.test(metric)
    ) {
      out.push(
        warn('metric.unknownInvariant', `"${metric}" is not a recognized invariant metric.`, path)
      )
    }
    return
  }
  // simulation
  if (metric.startsWith('topology.')) {
    out.push(
      err(
        'metric.kindMismatch',
        `simulation check uses a topology metric "${metric}" — set kind:"topology" or use a verdict metric.`,
        path
      )
    )
    return
  }
  if (SIMULATION_METRICS.has(metric)) {
    return
  }
  if (metric.startsWith('summary.') || metric.startsWith('perNode.')) {
    out.push(
      warn(
        'metric.uncommon',
        `"${metric}" is an uncommon verdict path — verify it resolves (see the known metric list).`,
        path
      )
    )
    return
  }
  out.push(
    warn(
      'metric.unrecognized',
      `"${metric}" is not a recognized metric key — verify it resolves against the verdict.`,
      path
    )
  )
}

/**
 * Validates a QuestionPackage against the authoring contract. Returns diagnostics
 * (empty ⇒ clean). Errors should block a save; warnings are advisory.
 */
/**
 * Domains ↔ rules consistency (advisory). A question's declared `domains` should each
 * match how it is actually graded, so a mis-tag is caught at authoring time. A question
 * may span several domains (e.g. compute + storage). V1 only ships `compute` / `storage`;
 * the other domains warn because their physics/traits are V2.
 */
function validateDomains(pkg: QuestionPackage, out: AuthoringDiagnostic[]): void {
  const domains = pkg.domains
  if (!domains || domains.length === 0) {
    out.push(
      warn(
        'domains.missing',
        'No `domains` declared. Set at least one so the platform can switch palette / edge-lock / grading emphasis per bottleneck domain.'
      )
    )
    return
  }

  // Duplicate guard — the schema allows [] but not a set, so catch repeats here.
  const seen = new Set<string>()
  for (const d of domains) {
    if (seen.has(d)) out.push(warn('domains.duplicate', `domain '${d}' is listed more than once.`))
    seen.add(d)
  }

  const hasSimCheck = (pkg.rubric?.checks ?? []).some(
    (c) => inferRubricCheckKind(c) === 'simulation'
  )
  // A compute-domain judgment question ("don't add wasteful compute/edge") is graded
  // by forbidUnjustified rather than a perf metric — accept it as a valid compute shape.
  const hasForbidUnjustified = (pkg.semanticCriteria ?? []).some(
    (c) => c.kind === 'forbidUnjustified'
  )
  // Storage-domain questions grade the store choice via `storageFit` OR the
  // fan-out shape via `fanout` — both are data-domain criteria.
  const hasDataCriterion = (pkg.semanticCriteria ?? []).some(
    (c) => c.kind === 'storageFit' || c.kind === 'fanout'
  )
  const hasJustify = (pkg.justify ?? []).length > 0

  for (const domain of seen) {
    switch (domain) {
      case 'compute':
        if (!hasSimCheck && !hasForbidUnjustified)
          out.push(
            warn(
              'domains.mismatch',
              "domain 'compute' expects a simulation check (summary.latency.p99 / summary.throughput) or a forbidUnjustified judgment criterion."
            )
          )
        break
      case 'storage':
        if (!hasDataCriterion)
          out.push(
            warn(
              'domains.mismatch',
              "domain 'storage' expects a `storageFit` (store choice) or `fanout` (broadcast) semantic criterion."
            )
          )
        break
      case 'correctness':
        if (!hasJustify)
          out.push(
            warn(
              'domains.mismatch',
              "domain 'correctness' is carried by topology + justification; expected a `justify` prompt."
            )
          )
        break
      case 'network':
      case 'resilience':
      case 'cost':
        out.push(
          warn(
            'domains.v2',
            `domain '${domain}' is a V2 domain — its physics/traits (edge cost, circuit-breaking, budget) are not built yet.`
          )
        )
        break
    }
  }
}

export function validateAuthoredQuestion(pkg: QuestionPackage): AuthoringDiagnostic[] {
  const out: AuthoringDiagnostic[] = []

  validateDomains(pkg, out)

  // ── suite / rubric presence ────────────────────────────────────────────────
  if (!pkg.suite || pkg.suite.cases.length === 0) {
    out.push(err('suite.empty', 'The grading suite has no cases — nothing is run.', 'suite.cases'))
  }
  if (!pkg.rubric || pkg.rubric.checks.length === 0) {
    out.push(
      warn(
        'rubric.empty',
        'The rubric has no checks — the design is never scored on metrics.',
        'rubric.checks'
      )
    )
  }

  // ── metric keys ────────────────────────────────────────────────────────────
  const rubricMetrics = new Set<string>()
  ;(pkg.rubric?.checks ?? []).forEach((check, i) => {
    rubricMetrics.add(check.metric)
    validateMetric(check.metric, inferRubricCheckKind(check), `rubric.checks[${i}].metric`, out)
  })

  // ── scale numbers must be injected, not just displayed ─────────────────────
  const scale = pkg.prompt.scale ?? {}
  const cases = pkg.suite?.cases ?? []
  const anyBaseRps = cases.some((c) => typeof c.workload?.baseRps === 'number')
  const typedDist = cases.find(
    (c) =>
      Array.isArray(c.workload?.requestDistribution) && c.workload!.requestDistribution!.length >= 1
  )?.workload?.requestDistribution

  if (typeof scale.peakRps === 'number' && !anyBaseRps) {
    out.push(
      warn(
        'scale.rpsNotInjected',
        'prompt.scale.peakRps is set but no suite case injects workload.baseRps — the load is display-only.',
        'suite.cases'
      )
    )
  }
  if (typeof scale.readWriteRatio === 'number') {
    const hasReadWrite =
      Array.isArray(typedDist) &&
      typedDist.some((d) => /read/i.test(d.type)) &&
      typedDist.some((d) => /write/i.test(d.type))
    if (!hasReadWrite) {
      out.push(
        warn(
          'scale.mixNotInjected',
          'prompt.scale.readWriteRatio is set but no suite case injects a typed read/write requestDistribution — the ratio is display-only and does not stress the design (alignment §3/§9).',
          'suite.cases'
        )
      )
    }
  }

  // ── requestDistribution entries need sizeBytes (bank finding #1) ────────────
  cases.forEach((c, ci) => {
    ;(c.workload?.requestDistribution ?? []).forEach((d, di) => {
      if (typeof (d as { sizeBytes?: number }).sizeBytes !== 'number') {
        out.push(
          warn(
            'workload.missingSizeBytes',
            `requestDistribution entry "${d.type}" is missing sizeBytes — a merged topology requires it.`,
            `suite.cases[${ci}].workload.requestDistribution[${di}]`
          )
        )
      }
    })
  })

  // ── orphan NFRs: each NFR should map to a rubric check ─────────────────────
  ;(pkg.prompt.nonFunctionalRequirements ?? []).forEach((nfr, i) => {
    if (nfr.metric === 'availability') {
      if (!rubricMetrics.has('summary.errorRate')) {
        out.push(
          warn(
            'nfr.orphan',
            'availability NFR has no rubric check — availability ≈ 1 - errorRate; add a summary.errorRate check.',
            `prompt.nonFunctionalRequirements[${i}]`
          )
        )
      }
      return
    }
    const expected = NFR_TO_VERDICT[nfr.metric]
    if (expected && !rubricMetrics.has(expected)) {
      out.push(
        warn(
          'nfr.orphan',
          `NFR "${nfr.metric}" has no corresponding rubric check (expected a check on "${expected}").`,
          `prompt.nonFunctionalRequirements[${i}]`
        )
      )
    }
  })

  // ── performance-vs-correctness boundary (alignment §1) ─────────────────────
  if (pkg.workloadCategory === 'correctness-heavy') {
    const perfCheck = (pkg.rubric?.checks ?? []).find(
      (c) => inferRubricCheckKind(c) === 'simulation' && /latency|throughput/i.test(c.metric)
    )
    if (perfCheck) {
      out.push(
        warn(
          'correctness.simulationCheck',
          `A correctness-heavy question has a simulation performance check ("${perfCheck.metric}") — the sim cannot measure correctness; grade it via structural/semantic + justification instead.`,
          'rubric.checks'
        )
      )
    }
  }

  // ── dangling justify bindings ──────────────────────────────────────────────
  const justifyIds = new Set((pkg.justify ?? []).map((j) => j.id))
  ;(pkg.semanticCriteria ?? []).forEach((c, i) => {
    if (c.kind === 'forbidUnjustified' && c.justifyId && !justifyIds.has(c.justifyId)) {
      out.push(
        err(
          'justify.dangling',
          `forbidUnjustified references justifyId "${c.justifyId}" which is not defined in justify[].`,
          `semanticCriteria[${i}].justifyId`
        )
      )
    }
  })

  // ── guardedPath under a read/write mix (alignment §9) ──────────────────────
  if (typeof scale.readWriteRatio === 'number') {
    ;(pkg.semanticCriteria ?? []).forEach((c, i) => {
      if (c.kind === 'guardedPath' && c.to) {
        out.push(
          warn(
            'guardedPath.readWriteMix',
            `guardedPath (${c.from}→${c.guard}→${c.to}) on a read/write-mix question can wrongly fail a correct design if writes legitimately bypass the guard — confirm this is an all-traffic guard, not a "reads-through-cache" rule (use the p99 simulation check for that).`,
            `semanticCriteria[${i}]`
          )
        )
      }
    })
  }

  return out
}

/** Convenience: true when there are no `error`-level diagnostics. */
export function isAuthoredValid(diagnostics: readonly AuthoringDiagnostic[]): boolean {
  return !diagnostics.some((d) => d.level === 'error')
}
