/* eslint-disable @typescript-eslint/explicit-function-return-type -- This module runs as standalone JavaScript without a TypeScript build step. */

/**
 * Grading budget audit for one Question Studio project and its coverage map.
 *
 * Every graded row must belong to exactly one tier:
 *
 *   - sanity: a small, shared set of shape rules (one source, connected graph,
 *     balancer in the middle, async work has a consumer);
 *   - carried-forward: presence of a headline component from an earlier
 *     question in the same series, never its runtime behavior;
 *   - core: at most one check per source bullet the question adds.
 *
 * The audit is JSON-only so it runs without a simulator checkout. Engine-backed
 * checks (compile, advisories, reference and near-miss grading) live in the
 * repository audit script.
 */

export const GRADING_BUDGET = Object.freeze({
  sanityMax: 5,
  carriedForwardMax: 4,
  coreMax: 6,
  totalMax: 15,
  checksPerRequirementMax: 1
})

/** NFR metric to the rubric metric that grades it. Mirrors the engine table. */
export const NFR_RUBRIC_METRIC = Object.freeze({
  latency_p99: 'summary.latency.p99',
  latency_p50: 'summary.latency.p50',
  error_rate: 'summary.errorRate',
  availability: 'summary.errorRate',
  throughput: 'summary.throughput'
})

const SANITY_STRUCTURAL_KINDS = new Set([
  'requires_single_source',
  'requires_connected_graph',
  'requires_path',
  'requires_edge',
  'requires_redundancy',
  'requires_component'
])
const SANITY_SEMANTIC_KINDS = new Set(['placement'])
const PRESENCE_STRUCTURAL_KINDS = new Set(['requires_component', 'requires_category'])
const PRESENCE_SEMANTIC_KINDS = new Set(['componentPresence'])
const REQUIREMENT_KINDS = new Set(['requirement', 'concept', 'nfr'])
const REQUIREMENT_STATUSES = new Set(['graded', 'covered', 'explained'])

/** Every graded row in a project, keyed by id, with its axis and shape. */
export function collectGradedRows(project) {
  const question = project?.question ?? {}
  const rows = new Map()
  const add = (axis, row, kind) => {
    if (row && typeof row.id === 'string') rows.set(row.id, { id: row.id, axis, kind, row })
  }
  for (const row of question.structuralRules ?? []) add('structural', row, row.kind)
  for (const row of question.semanticRules ?? []) add('semantic', row, row.kind)
  for (const row of question.metricRules ?? []) add('metric', row, 'metric')
  for (const row of question.rubricChecks ?? []) add('rubric', row, 'metric')
  return rows
}

function countIds(rows, ids) {
  const seen = new Map()
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
  return seen
}

function isSanityShape(entry) {
  return entry.axis === 'structural'
    ? SANITY_STRUCTURAL_KINDS.has(entry.kind)
    : entry.axis === 'semantic' && SANITY_SEMANTIC_KINDS.has(entry.kind)
}

function isPresenceOnly(entry) {
  return entry.axis === 'structural'
    ? PRESENCE_STRUCTURAL_KINDS.has(entry.kind)
    : entry.axis === 'semantic' && PRESENCE_SEMANTIC_KINDS.has(entry.kind)
}

function duplicateFindings(project) {
  const question = project?.question ?? {}
  const findings = []
  const required = new Map()
  for (const rule of question.structuralRules ?? []) {
    if (rule.kind === 'requires_component') {
      required.set(
        rule.componentType,
        Math.max(required.get(rule.componentType) ?? 0, rule.minCount ?? 1)
      )
    }
  }
  for (const rule of question.semanticRules ?? []) {
    if (rule.kind !== 'componentPresence') continue
    const structuralMin = required.get(rule.componentType)
    const parentOfProperty = (question.semanticRules ?? []).some(
      (other) => other.kind === 'componentProperty' && other.parentId === rule.id
    )
    if (structuralMin !== undefined && structuralMin >= (rule.minCount ?? 1) && !parentOfProperty) {
      findings.push(
        error(
          'budget.duplicate',
          `Semantic rule "${rule.id}" repeats the structural requirement for ${rule.componentType}.`
        )
      )
    }
  }
  const signatures = new Map()
  const keyed = [
    ...(question.structuralRules ?? []).map((rule) => [
      rule.id,
      `structural:${rule.kind}:${rule.componentType ?? ''}:${rule.fromType ?? ''}:${rule.toType ?? ''}:${rule.mode ?? ''}`
    ]),
    ...(question.rubricChecks ?? []).map((check) => [
      check.id,
      `rubric:${check.metric}:${check.op}`
    ]),
    ...(question.metricRules ?? []).map((rule) => [
      rule.id,
      `metric:${rule.metric}:${rule.operator}`
    ])
  ]
  for (const [id, signature] of keyed) {
    const earlier = signatures.get(signature)
    if (earlier) {
      findings.push(error('budget.duplicate', `"${id}" grades the same thing as "${earlier}".`))
    } else {
      signatures.set(signature, id)
    }
  }
  return findings
}

function error(code, message) {
  return { level: 'error', code, message }
}

/**
 * Audits one project against its coverage map. Returns findings plus the tier
 * tally; any `error` finding means the question is outside the budget.
 */
export function auditGradingBudget(project, coverage) {
  const findings = []
  const rows = collectGradedRows(project)
  const question = project?.question ?? {}

  if (coverage?.artifact !== 'simulator-question-coverage') {
    findings.push(
      error('coverage.artifact', 'Coverage artifact marker must be "simulator-question-coverage".')
    )
  }
  if (coverage?.questionId !== question.id) {
    findings.push(
      error('coverage.questionId', 'Coverage questionId does not match the project question id.')
    )
  }
  if (
    typeof coverage?.source?.document !== 'string' ||
    typeof coverage?.source?.section !== 'string'
  ) {
    findings.push(error('coverage.source', 'Coverage must name the source document and section.'))
  }

  const requirements = Array.isArray(coverage?.requirements) ? coverage.requirements : []
  if (requirements.length === 0) {
    findings.push(
      error('coverage.requirements', 'Coverage must list every source bullet as a requirement.')
    )
  }
  const sanity = Array.isArray(coverage?.sanity) ? coverage.sanity : []
  const carriedForward = (
    Array.isArray(coverage?.carriedForward) ? coverage.carriedForward : []
  ).map((entry) => entry?.check)

  const core = []
  const coreCounted = []
  const requirementIds = new Set()
  for (const requirement of requirements) {
    const label = requirement?.id ?? '(missing id)'
    if (typeof requirement?.id !== 'string' || requirementIds.has(requirement.id)) {
      findings.push(
        error('coverage.requirementId', `Requirement ids must be unique strings (${label}).`)
      )
    }
    requirementIds.add(requirement?.id)
    if (typeof requirement?.text !== 'string' || requirement.text.trim() === '') {
      findings.push(
        error('coverage.requirementText', `Requirement ${label} must quote its source bullet.`)
      )
    }
    if (!REQUIREMENT_KINDS.has(requirement?.kind)) {
      findings.push(
        error(
          'coverage.requirementKind',
          `Requirement ${label} kind must be requirement, concept, or nfr.`
        )
      )
    }
    if (!REQUIREMENT_STATUSES.has(requirement?.status)) {
      findings.push(
        error(
          'coverage.requirementStatus',
          `Requirement ${label} status must be graded, covered, or explained.`
        )
      )
      continue
    }
    const checks = Array.isArray(requirement.checks) ? requirement.checks : []
    if (requirement.status === 'explained') {
      if (
        checks.length > 0 ||
        typeof requirement.reason !== 'string' ||
        !requirement.reason.trim()
      ) {
        findings.push(
          error(
            'coverage.explained',
            `Explained requirement ${label} needs a reason and no checks.`
          )
        )
      }
      continue
    }
    if (checks.length === 0) {
      findings.push(
        error(
          'coverage.unmapped',
          `Requirement ${label} is ${requirement.status} but names no check.`
        )
      )
    }
    if (requirement.status === 'graded') {
      // A componentProperty rule needs a componentPresence parent; the pair is
      // one requirement in the rule language, so the parent is not counted.
      const parents = new Set(
        checks
          .map((id) => rows.get(id))
          .filter((entry) => entry?.kind === 'componentProperty')
          .map((entry) => entry.row.parentId)
      )
      const effective = checks.filter((id) => !parents.has(id))
      if (effective.length > GRADING_BUDGET.checksPerRequirementMax) {
        findings.push(
          error(
            'budget.requirementChecks',
            `Requirement ${label} uses ${effective.length} checks; grade one source bullet with one check.`
          )
        )
      }
      core.push(...checks)
      coreCounted.push(...effective)
    }
    for (const id of checks) {
      if (!rows.has(id)) {
        findings.push(
          error('coverage.unknownCheck', `Requirement ${label} names unknown check "${id}".`)
        )
      }
    }
  }

  // Each graded row belongs to exactly one tier.
  const tierOf = new Map()
  const assign = (ids, tier) => {
    for (const id of ids) {
      if (!rows.has(id)) {
        findings.push(error('coverage.unknownCheck', `Tier ${tier} names unknown check "${id}".`))
        continue
      }
      const existing = tierOf.get(id)
      if (existing && !(existing === 'core' && tier === 'core')) {
        findings.push(
          error('coverage.tierConflict', `Check "${id}" is listed as both ${existing} and ${tier}.`)
        )
      }
      tierOf.set(id, tier)
    }
  }
  assign(sanity, 'sanity')
  assign(carriedForward, 'carried-forward')
  for (const [id, count] of countIds(rows, core)) {
    if (count > 1) {
      findings.push(
        error('coverage.sharedCheck', `Check "${id}" grades more than one requirement.`)
      )
    }
    assign([id], 'core')
  }
  for (const id of rows.keys()) {
    if (!tierOf.has(id)) {
      findings.push(
        error(
          'coverage.untraced',
          `Check "${id}" is not traced to a sanity rule, carried-forward component, or source bullet.`
        )
      )
    }
  }

  for (const id of sanity) {
    const entry = rows.get(id)
    if (entry && !isSanityShape(entry)) {
      findings.push(
        error(
          'budget.sanityShape',
          `Sanity check "${id}" must be a structural shape rule or placement, not ${entry.kind}.`
        )
      )
    }
  }
  for (const entry of coverage?.carriedForward ?? []) {
    const row = rows.get(entry?.check)
    if (row && !isPresenceOnly(row)) {
      findings.push(
        error(
          'budget.carriedForwardBehavior',
          `Carried-forward check "${entry.check}" re-grades ${row.kind}; carry earlier lessons forward as presence only.`
        )
      )
    }
    if (typeof entry?.from !== 'string' || !entry.from.trim()) {
      findings.push(
        error(
          'coverage.carriedForwardSource',
          `Carried-forward check "${entry?.check}" must name the question it comes from.`
        )
      )
    }
  }
  if (carriedForward.length > 0 && typeof coverage?.series?.buildsOn !== 'string') {
    findings.push(error('coverage.series', 'Carried-forward checks require series.buildsOn.'))
  }

  const tally = {
    sanity: sanity.length,
    carriedForward: carriedForward.length,
    core: new Set(coreCounted).size,
    total: rows.size
  }
  const caps = [
    ['sanity', tally.sanity, GRADING_BUDGET.sanityMax],
    ['carried-forward', tally.carriedForward, GRADING_BUDGET.carriedForwardMax],
    ['core', tally.core, GRADING_BUDGET.coreMax],
    ['total', tally.total, GRADING_BUDGET.totalMax]
  ]
  for (const [tier, count, max] of caps) {
    if (count > max) {
      findings.push(error('budget.cap', `${tier} uses ${count} checks; the budget allows ${max}.`))
    }
  }

  // Learner-visible NFRs must be stated by the source and graded.
  const rubricMetrics = new Set((question.rubricChecks ?? []).map((check) => check.metric))
  const metricRuleMetrics = new Set((question.metricRules ?? []).map((rule) => rule.metric))
  const nfrRequirements = requirements.filter((requirement) => requirement?.kind === 'nfr')
  for (const nfr of question.prompt?.nonFunctionalRequirements ?? []) {
    const expected = NFR_RUBRIC_METRIC[nfr.metric]
    if (expected && !rubricMetrics.has(expected) && !metricRuleMetrics.has(nfr.metric)) {
      findings.push(
        error(
          'budget.nfrUngraded',
          `NFR "${nfr.metric}" is shown to learners but no check grades "${expected}".`
        )
      )
    }
    if (!nfrRequirements.some((requirement) => requirement.status === 'graded')) {
      findings.push(
        error(
          'coverage.nfrUntraced',
          `NFR "${nfr.metric}" is not traced to a source bullet of kind "nfr".`
        )
      )
    }
  }

  for (const design of project?.assets?.gamedTopologies ?? []) {
    if (tierOf.get(design.expectedObligationId) !== 'core') {
      findings.push(
        error(
          'budget.nearMissTarget',
          `Near miss "${design.id}" must be caught by a core check, not "${design.expectedObligationId}".`
        )
      )
    }
  }
  if ((project?.assets?.gamedTopologies ?? []).length === 0) {
    findings.push(
      error('budget.nearMissMissing', 'Add at least one near miss caught by a core check.')
    )
  }

  for (const advisory of coverage?.advisories ?? []) {
    if (
      typeof advisory?.code !== 'string' ||
      typeof advisory?.reason !== 'string' ||
      !advisory.reason.trim()
    ) {
      findings.push(
        error('coverage.advisory', 'Every explained advisory needs a code and a reason.')
      )
    }
  }

  findings.push(...duplicateFindings(project))
  return { findings, tally }
}
