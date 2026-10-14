import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GRADING_BUDGET,
  NFR_RUBRIC_METRIC,
  auditGradingBudget
} from '../../../skills/simulator-question-author/scripts/grading-budget.mjs'
import { auditSimulatorQuestion } from '../../../scripts/audit-simulator-question'
import { NFR_METRIC_TO_RUBRIC_METRIC } from './authoringCapabilities'

const SERIES = resolve(
  __dirname,
  '../../../skills/simulator-question-author/examples/food-delivery-series'
)
const GATEWAY_DIR = join(SERIES, '02-api-gateway')
const GATEWAY = 'food-delivery-api-gateway'

type Json = Record<string, any>

function load(name: string): Json {
  return JSON.parse(readFileSync(join(GATEWAY_DIR, `${GATEWAY}.${name}.json`), 'utf8'))
}

function codes(project: Json, coverage: Json): string[] {
  return auditGradingBudget(project, coverage).findings.map((finding) => finding.code)
}

function rubricCheck(id: string, metric: string): Json {
  return { id, metric, op: '>=', value: 1, points: 1, description: id }
}

describe('grading budget audit', () => {
  it('accepts the bundled API-gateway question', () => {
    const { findings, tally } = auditGradingBudget(
      load('simulator-question-project'),
      load('coverage')
    )
    expect(findings).toEqual([])
    expect(tally.core).toBeLessThanOrEqual(GRADING_BUDGET.coreMax)
    expect(tally.total).toBeLessThanOrEqual(GRADING_BUDGET.totalMax)
  })

  it('mirrors the engine NFR-to-rubric metric table', () => {
    // The engine validator special-cases availability as 1 - errorRate.
    expect(NFR_RUBRIC_METRIC).toEqual({
      ...NFR_METRIC_TO_RUBRIC_METRIC,
      availability: 'summary.errorRate'
    })
  })

  it('rejects more core checks than the budget allows', () => {
    const project = load('simulator-question-project')
    const coverage = load('coverage')
    for (const metric of ['rateLimit.admitted', 'apiRouting.routedTargets']) {
      const id = `extra-${metric}`
      project.question.rubricChecks.push(rubricCheck(id, metric))
      coverage.requirements.push({ id, kind: 'concept', text: id, status: 'graded', checks: [id] })
    }
    expect(codes(project, coverage)).toContain('budget.cap')
  })

  it('rejects a check that is not traced to the source', () => {
    const project = load('simulator-question-project')
    project.question.rubricChecks.push(rubricCheck('invented', 'rateLimit.admitted'))
    expect(codes(project, load('coverage'))).toContain('coverage.untraced')
  })

  it('rejects grading one source bullet with several checks', () => {
    const project = load('simulator-question-project')
    const coverage = load('coverage')
    project.question.rubricChecks.push(rubricCheck('second-auth', 'authentication.attempts'))
    coverage.requirements.find((r: Json) => r.id === 'r-authenticated').checks.push('second-auth')
    expect(codes(project, coverage)).toContain('budget.requirementChecks')
  })

  it('rejects re-grading an earlier lesson instead of carrying its presence forward', () => {
    const project = load('simulator-question-project')
    const coverage = load('coverage')
    project.question.rubricChecks.push(rubricCheck('queue-accepts', 'queue.accepted'))
    coverage.carriedForward.push({
      check: 'queue-accepts',
      from: 'food-delivery-load-balancer-and-queue'
    })
    coverage.series = { buildsOn: 'food-delivery-load-balancer-and-queue' }
    expect(codes(project, coverage)).toContain('budget.carriedForwardBehavior')
  })

  it('rejects a runtime metric used as a sanity check', () => {
    const coverage = load('coverage')
    coverage.sanity.push('rate-limit-holds')
    coverage.requirements = coverage.requirements.filter((r: Json) => r.id !== 'c-rate-limiting')
    expect(codes(load('simulator-question-project'), coverage)).toContain('budget.sanityShape')
  })

  it('rejects a learner-visible NFR that nothing grades', () => {
    const project = load('simulator-question-project')
    project.question.prompt.nonFunctionalRequirements = [
      { id: 'nfr-1', metric: 'error_rate', operator: '<', value: 5, unit: 'percent' }
    ]
    expect(codes(project, load('coverage'))).toEqual(
      expect.arrayContaining(['budget.nfrUngraded', 'coverage.nfrUntraced'])
    )
  })

  it('rejects a semantic presence rule that repeats a structural one', () => {
    const project = load('simulator-question-project')
    const coverage = load('coverage')
    project.question.semanticRules.push({
      id: 'services-again',
      kind: 'componentPresence',
      points: 1,
      description: 'Use services.',
      componentType: 'microservice',
      minCount: 1
    })
    coverage.sanity.push('services-again')
    expect(codes(project, coverage)).toContain('budget.duplicate')
  })

  it('rejects a near miss that is only caught by a sanity check', () => {
    const project = load('simulator-question-project')
    project.assets.gamedTopologies[0].expectedObligationId = 'single-source'
    expect(codes(project, load('coverage'))).toContain('budget.nearMissTarget')
  })

  it('requires an explained requirement to carry a reason and no checks', () => {
    const coverage = load('coverage')
    coverage.requirements.push({
      id: 'vague',
      kind: 'requirement',
      text: 'Be fast.',
      status: 'explained'
    })
    expect(codes(load('simulator-question-project'), coverage)).toContain('coverage.explained')
  })
})

describe('question audit advisories', () => {
  let workspace: string | undefined

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true })
    workspace = undefined
  })

  function copyGateway(edit: (coverage: Json) => void): string {
    workspace = mkdtempSync(join(tmpdir(), 'question-audit-'))
    cpSync(GATEWAY_DIR, workspace, { recursive: true })
    const coveragePath = join(workspace, `${GATEWAY}.coverage.json`)
    const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'))
    edit(coverage)
    writeFileSync(coveragePath, JSON.stringify(coverage))
    return workspace
  }

  it('fails a Studio advisory that is neither fixed nor explained', () => {
    const directory = copyGateway((coverage) => {
      coverage.advisories = coverage.advisories.filter(
        (advisory: Json) => advisory.code !== 'guardedPath.readWriteMix'
      )
    })
    const audit = auditSimulatorQuestion(directory, GATEWAY)
    expect(audit.passed).toBe(false)
    expect(audit.findings.map((finding) => finding.code)).toContain('advisory.unexplained')
  })

  it('fails an explanation for an advisory the Studio no longer raises', () => {
    const directory = copyGateway((coverage) => {
      coverage.advisories.push({ code: 'nfr.orphan', reason: 'stale' })
    })
    const audit = auditSimulatorQuestion(directory, GATEWAY)
    expect(audit.findings.map((finding) => finding.code)).toContain('advisory.stale')
  })
})
