import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { compileQuestionAuthoringPreview } from '../src/engine/analysis/questionAuthoringCompiler'
import { parseQuestionAuthoringProject } from '../src/engine/analysis/questionAuthoringProject'
import { parseQuestionPackage } from '../src/engine/analysis/question'
import { runQuestionAuthoringVerification } from '../src/engine/analysis/questionAuthoringVerification'
import { buildStudentAssignmentPackage } from '../src/engine/analysis/studentAssignmentPackage'
import type { TopologyJSON } from '../src/engine/core/types'
import { TopologyJSONSchema, validateTopology } from '../src/engine/validation/validator'
import { auditGradingBudget } from '../skills/simulator-question-author/scripts/grading-budget.mjs'

export interface AuditFinding {
  level: 'error' | 'warning'
  code: string
  message: string
}

export interface SimulatorQuestionAudit {
  slug: string
  passed: boolean
  findings: AuditFinding[]
  tally: { sanity: number; carriedForward: number; core: number; total: number }
  advisories: { code: string; path?: string; explained: boolean }[]
}

interface CoverageAdvisory {
  code: string
  path?: string
  reason: string
}

function readJson(directory: string, name: string): unknown {
  return JSON.parse(readFileSync(resolve(directory, name), 'utf8'))
}

function matchesAdvisory(explained: CoverageAdvisory, code: string, path?: string): boolean {
  return explained.code === code && (explained.path === undefined || explained.path === path)
}

/**
 * Audits one authored question end to end: the JSON-level grading budget plus
 * the engine checks the Question Studio runs (compile, advisories, reference
 * and near-miss grading, student projection).
 */
export function auditSimulatorQuestion(directory: string, slug: string): SimulatorQuestionAudit {
  const findings: AuditFinding[] = []
  const fail = (code: string, message: string): void => {
    findings.push({ level: 'error', code, message })
  }

  const rawProject = readJson(directory, `${slug}.simulator-question-project.json`)
  const coverage = readJson(directory, `${slug}.coverage.json`) as {
    advisories?: CoverageAdvisory[]
  }
  const budget = auditGradingBudget(rawProject, coverage)
  findings.push(...(budget.findings as AuditFinding[]))

  const project = parseQuestionAuthoringProject(rawProject)
  const authoredPackage = parseQuestionPackage(readJson(directory, `${slug}.question-package.json`))
  const solution = TopologyJSONSchema.parse(
    readJson(directory, `${slug}.solution-topology.json`)
  ) as TopologyJSON

  const preview = compileQuestionAuthoringPreview(project)
  const advisories: SimulatorQuestionAudit['advisories'] = []
  if (preview.status !== 'ready') {
    fail(
      'compile.blocked',
      `Question Studio compile blocked: ${preview.diagnostics.map((d) => d.message).join('; ')}`
    )
  } else {
    if (!isDeepStrictEqual(preview.questionPackage, authoredPackage)) {
      fail('compile.drift', 'The question package is not the exact compile of the project.')
    }
    const explained = coverage.advisories ?? []
    for (const diagnostic of preview.diagnostics) {
      const isExplained = explained.some((entry) =>
        matchesAdvisory(entry, diagnostic.code, diagnostic.path)
      )
      advisories.push({
        code: diagnostic.code,
        ...(diagnostic.path ? { path: diagnostic.path } : {}),
        explained: isExplained
      })
      if (!isExplained) {
        fail(
          'advisory.unexplained',
          `Studio advisory ${diagnostic.code}${diagnostic.path ? ` @ ${diagnostic.path}` : ''} is neither fixed nor explained: ${diagnostic.message}`
        )
      }
    }
    for (const entry of explained) {
      if (
        !preview.diagnostics.some((diagnostic) =>
          matchesAdvisory(entry, diagnostic.code, diagnostic.path)
        )
      ) {
        fail(
          'advisory.stale',
          `Coverage explains advisory ${entry.code}${entry.path ? ` @ ${entry.path}` : ''}, which the Studio no longer raises.`
        )
      }
    }
  }

  const reference = project.assets.referenceTopology
  if (!reference || !isDeepStrictEqual(reference, solution)) {
    fail('solution.drift', 'The solution topology differs from the project reference topology.')
  }
  const topologyValidation = validateTopology(solution)
  if (!topologyValidation.valid) {
    fail('solution.invalid', `Reference topology is invalid: ${JSON.stringify(topologyValidation)}`)
  }

  const verification = runQuestionAuthoringVerification(authoredPackage, {
    reference: { id: 'reference', label: 'Reference', topology: solution },
    gamed: project.assets.gamedTopologies
      .filter((design) => design.topology)
      .map((design) => ({
        id: design.id,
        label: design.label,
        topology: design.topology!,
        ...(design.misconception ? { misconception: design.misconception } : {}),
        ...(design.expectedObligationId
          ? { expectedObligationId: design.expectedObligationId }
          : {})
      }))
  })
  for (const blocker of verification.blockers) fail('verification.blocker', blocker)
  if (project.verification?.signature !== verification.signature || !project.verification.ready) {
    fail('verification.stale', 'The project verification proof is missing, stale, or not ready.')
  }

  const studentName = `${slug}.student-assignment.json`
  if (existsSync(resolve(directory, studentName))) {
    const student = readJson(directory, studentName)
    if (!isDeepStrictEqual(student, buildStudentAssignmentPackage(authoredPackage))) {
      fail('student.drift', 'The student assignment is not the projection of the package.')
    }
  }

  return {
    slug,
    passed: !findings.some((finding) => finding.level === 'error'),
    findings,
    tally: budget.tally,
    advisories
  }
}

function main(): void {
  const [directory, slug] = process.argv.slice(2)
  if (!directory || !slug) {
    console.error('Usage: npm run audit:simulator-question -- <directory> <slug>')
    process.exit(2)
  }
  const report = auditSimulatorQuestion(resolve(directory), slug)
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exit(1)
}

// Run as a CLI only when executed directly, not when imported by tests.
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
