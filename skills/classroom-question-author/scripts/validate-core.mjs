#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type -- This validator runs as standalone JavaScript without a TypeScript build step. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { auditGradingBudget } from './grading-budget.mjs'

const [directory, slug] = process.argv.slice(2)
if (!directory || !slug) {
  console.error('Usage: node scripts/validate-artifacts.mjs <output-directory> <slug>')
  process.exit(2)
}

const names = {
  project: `${slug}.simulator-question-project.json`,
  question: `${slug}.question-package.json`,
  solution: `${slug}.solution-topology.json`,
  coverage: `${slug}.coverage.json`,
  student: `${slug}.student-assignment.json`
}

function load(name) {
  const path = resolve(directory, name)
  const source = readFileSync(path, 'utf8')
  if (source.includes('{{')) throw new Error(`${name} contains an unresolved placeholder.`)
  return JSON.parse(source)
}

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function accepted(placed, required) {
  if (placed === required) return true
  return required === 'load-balancer' && ['load-balancer-l4', 'load-balancer-l7'].includes(placed)
}

const project = load(names.project)
const question = load(names.question)
const solution = load(names.solution)
const coverage = load(names.coverage)

check(project.artifact === 'dsds-question-project', 'Project artifact marker is invalid.')
check(question.version && question.suite && question.rubric, 'Question package shape is invalid.')
check(
  typeof solution.id === 'string' &&
    typeof solution.name === 'string' &&
    solution.global &&
    Array.isArray(solution.nodes) &&
    solution.nodes.length > 0 &&
    Array.isArray(solution.edges),
  'Solution must be canonical TopologyJSON with id, name, global, nodes, and edges.'
)
check(
  !solution.nodes.some((node) => node.data?.rendererType),
  'Solution contains canvas renderer data.'
)
check(project.question.id === question.id, 'Project and package IDs differ.')
check(project.question.title === question.title, 'Project and package titles differ.')
check(
  project.question.setup.passThreshold === question.rubric.passThreshold,
  'Project and package pass thresholds differ.'
)

const allowed = question.constraints?.allowedNodeTypes ?? []
if (allowed.length > 0) {
  for (const node of solution.nodes) {
    check(
      allowed.some((required) => accepted(node.type, required)),
      `Solution node ${node.id} (${node.type}) is not accepted by allowedNodeTypes.`
    )
  }
}

for (const testCase of question.suite.cases) {
  const weights = testCase.workload?.requestDistribution?.map((entry) => entry.weight) ?? []
  if (weights.length > 0)
    check(
      weights.reduce((sum, value) => sum + value, 0) > 0,
      `${testCase.id} has no positive request weight.`
    )
  const duration = testCase.global?.simulationDuration
  const warmup = testCase.global?.warmupDuration ?? 0
  if (duration !== undefined)
    check(warmup < duration, `${testCase.id} warmup must be below duration.`)
}

const dryRun = question.suite.dryRunCase
if (dryRun) {
  check(!dryRun.invariants?.length, 'Public dry run must not reveal hidden invariants.')
  check(!dryRun.faults?.length, 'Public dry run must not reveal hidden faults.')
  check(!dryRun.experiment, 'Public dry run must not reveal a hidden experiment.')
}

// Classroom mode: the block must match the project and use only snapshot vocabulary.
if (question.classroom) {
  const snapshot = JSON.parse(
    readFileSync(new URL('../references/capability-snapshot.json', import.meta.url), 'utf8')
  ).classroom
  const classroom = question.classroom
  check(
    JSON.stringify(project.question.setup.classroom) === JSON.stringify(classroom),
    'Project setup.classroom and package classroom differ.'
  )
  for (const level of classroom.abstractions ?? []) {
    check(snapshot.abstractions.includes(level), `Unknown classroom abstraction '${level}'.`)
  }
  const covered = snapshot.cards.flatMap((card) => card.covers)
  for (const [type, givens] of Object.entries(classroom.givens ?? {})) {
    check(
      covered.some((entry) => accepted(entry, type) || entry === type),
      `Classroom givens name '${type}', which has no concept card.`
    )
    for (const field of Object.keys(givens)) {
      check(snapshot.givenFields.includes(field), `Unknown classroom given '${field}' on ${type}.`)
    }
  }
  for (const field of Object.keys(classroom.targets ?? {})) {
    check(snapshot.targetFields.includes(field), `Unknown classroom target '${field}'.`)
  }
  for (const entry of classroom.checks ?? []) {
    check(
      snapshot.checkTemplates.includes(entry.template),
      `Classroom check ${entry.id} uses unknown template '${entry.template}'.`
    )
    check(
      entry.severity !== 'feedback' || entry.template === 'right-sized',
      `Classroom check ${entry.id}: only 'right-sized' can be feedback-only.`
    )
  }
  const objectiveIds = new Set((classroom.objectives ?? []).map((objective) => objective.id))
  for (const objective of classroom.objectives ?? []) {
    check(
      objective.statement.trim().toLowerCase().startsWith('the student can'),
      `Classroom objective '${objective.id}' must be an observable “The student can…” statement.`
    )
    check(
      (classroom.controls ?? []).some((control) => control.objectiveId === objective.id),
      `Classroom objective '${objective.id}' has no student decision.`
    )
    const evidence = (classroom.checks ?? []).filter(
      (entry) => entry.severity !== 'feedback' && entry.objectiveId === objective.id
    )
    check(evidence.length > 0, `Classroom objective '${objective.id}' has no scored evidence.`)
    check(
      evidence.length <= 2,
      `Classroom objective '${objective.id}' has more than two scored checks; keep minimal evidence.`
    )
  }
  for (const control of classroom.controls ?? []) {
    check(
      objectiveIds.has(control.objectiveId),
      `Classroom control '${control.id}' points to an unknown objective.`
    )
  }
  const evidenceKeys = new Set()
  for (const entry of (classroom.checks ?? []).filter((check) => check.severity !== 'feedback')) {
    check(
      entry.objectiveId && objectiveIds.has(entry.objectiveId),
      `Scored Classroom check '${entry.id}' must point to a known objective.`
    )
    const evidenceKey = [entry.objectiveId, entry.template, entry.via, entry.component].join('|')
    check(
      !evidenceKeys.has(evidenceKey),
      `Classroom check '${entry.id}' duplicates scored evidence.`
    )
    evidenceKeys.add(evidenceKey)
  }
  const classroomEnabled =
    classroom.abstractions === undefined || classroom.abstractions.includes('classroom')
  if (classroomEnabled) {
    check(allowed.length > 0, 'Classroom questions need an explicit allowedNodeTypes list.')
    const cardFor = (type) =>
      snapshot.cards.find((card) =>
        card.covers.some(
          (coveredType) => accepted(type, coveredType) || accepted(coveredType, type)
        )
      )
    const givenFor = (type) =>
      Object.entries(classroom.givens ?? {}).find(
        ([givenType]) => accepted(type, givenType) || accepted(givenType, type)
      )?.[1]
    for (const type of allowed) {
      const card = cardFor(type)
      check(card, `Classroom allowed type '${type}' has no concept card; use Architect mode.`)
      if (card?.role === 'compute') {
        check(
          Number.isFinite(givenFor(type)?.capacityRps),
          `Classroom capacity card '${type}' needs an explicit capacityRps given.`
        )
      }
    }
    const peak = question.suite.dryRunCase?.workload?.baseRps ?? question.prompt?.scale?.peakRps
    check(Number.isFinite(peak) && peak > 0, 'Classroom questions must state peak traffic.')
  }
}

if (existsSync(resolve(directory, names.student))) {
  const student = load(names.student)
  for (const key of ['suite', 'rubric', 'structuralRules', 'semanticCriteria', 'graderHints']) {
    check(!(key in student), `Student assignment leaks private ${key}.`)
  }
  check(student.id === question.id, 'Student assignment and package IDs differ.')
}

const { findings, tally } = auditGradingBudget(project, coverage)
for (const finding of findings)
  console.error(`[${finding.level}] ${finding.code}: ${finding.message}`)
if (findings.some((finding) => finding.level === 'error')) {
  console.error(`Grading budget failed for ${slug}.`)
  process.exit(1)
}

console.log(
  `Validated ${names.project}, ${names.question}, ${names.solution}, and ${names.coverage} ` +
    `(sanity ${tally.sanity}, carried forward ${tally.carriedForward}, core ${tally.core}, total ${tally.total}).`
)
