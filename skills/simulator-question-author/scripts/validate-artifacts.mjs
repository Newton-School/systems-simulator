#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type -- This validator runs as standalone JavaScript without a TypeScript build step. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [directory, slug] = process.argv.slice(2)
if (!directory || !slug) {
  console.error('Usage: node scripts/validate-artifacts.mjs <output-directory> <slug>')
  process.exit(2)
}

const names = {
  project: `${slug}.simulator-question-project.json`,
  question: `${slug}.question-package.json`,
  solution: `${slug}.solution-topology.json`
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

console.log(`Validated ${names.project}, ${names.question}, and ${names.solution}.`)
