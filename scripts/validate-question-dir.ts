/**
 * Validate a question trio directory:
 *   <dir>/question.json
 *   <dir>/reference-topology.json   -> must PASS all headless-checkable axes
 *   <dir>/gamed-topology.json       -> must FAIL on the intended axis
 *   <dir>/answers.json (optional)   -> JustificationAnswer[] for the reference
 *
 * Usage: tsx scripts/validate-question-dir.ts <dir> [<dir> ...]
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import process from 'node:process'
import { SimulationEngine } from '../src/engine/engine'
import { parseQuestionPackage, gradeAttemptWithArtifacts } from '../src/engine/analysis/question'
import { validateAuthoredQuestion } from '../src/engine/analysis/authoringValidator'
import { validateTopology } from '../src/engine/validation/validator'
import type { JustificationAnswer } from '../src/engine/analysis/justification'

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf-8'))
}

function loadTopology(path: string) {
  const v = validateTopology(loadJson(path))
  if (!v.valid || !v.data) {
    const msgs = (v.errors ?? []).map((e) => `${e.path ? e.path + ': ' : ''}${e.message}`)
    throw new Error(`topology invalid (${path}):\n    ${msgs.join('\n    ')}`)
  }
  return v.data
}

function gradeRows(
  pkg: ReturnType<typeof parseQuestionPackage>,
  topoPath: string,
  answers: JustificationAnswer[]
) {
  const topology = loadTopology(topoPath)
  const { grade } = gradeAttemptWithArtifacts(
    pkg,
    topology,
    (t) => new SimulationEngine(t).run(),
    answers
  )
  return grade.contract
}

let hadFailure = false

for (const dir of process.argv.slice(2)) {
  if (!statSync(dir).isDirectory()) {
    continue
  }

  const qPath = join(dir, 'question.json')
  const refPath = join(dir, 'reference-topology.json')
  const gamedPath = join(dir, 'gamed-topology.json')
  const answersPath = join(dir, 'answers.json')
  const gamedAnswersPath = join(dir, 'gamed-answers.json')
  const answers: JustificationAnswer[] = existsSync(answersPath)
    ? (loadJson(answersPath) as JustificationAnswer[])
    : []
  // Gamed reuses the reference answers by default, so discrimination shows up on
  // the intended structural/semantic/simulation axis rather than justification.
  // A question whose discriminator *is* justification supplies its own (often
  // empty) gamed-answers.json.
  const gamedAnswers: JustificationAnswer[] = existsSync(gamedAnswersPath)
    ? (loadJson(gamedAnswersPath) as JustificationAnswer[])
    : answers

  console.log(`\n${BOLD}══ ${dir} ══${RESET}`)

  let pkg: ReturnType<typeof parseQuestionPackage>
  try {
    pkg = parseQuestionPackage(loadJson(qPath))
  } catch (e) {
    hadFailure = true
    console.log(`${RED}✗ question.json failed to parse:${RESET} ${(e as Error).message}`)
    continue
  }

  const diags = validateAuthoredQuestion(pkg)
  const errors = diags.filter((d) => d.level === 'error')
  const warns = diags.filter((d) => d.level !== 'error')
  if (errors.length) {
    hadFailure = true
    for (const d of errors) console.log(`${RED}✗ authoring ${d.code}${RESET}: ${d.message}`)
  }
  for (const d of warns) console.log(`${YELLOW}⚠ authoring ${d.code}${RESET}: ${d.message}`)

  // Reference -> everything checkable should pass
  let refTests: Array<{ id: string; name: string; passed: boolean }> | null = null
  let gamedTests: Array<{ id: string; name: string; passed: boolean }> | null = null
  try {
    const ref = gradeRows(pkg, refPath, answers)
    refTests = ref.tests
    const failed = ref.tests.filter((t) => !t.passed)
    if (failed.length === 0) {
      console.log(`${GREEN}✓ reference PASSES all ${ref.totalTests} tests${RESET}`)
    } else {
      hadFailure = true
      console.log(`${RED}✗ reference has ${failed.length}/${ref.totalTests} FAILING tests:${RESET}`)
      for (const t of failed)
        console.log(`    ${RED}- ${t.id} (${t.name})${RESET} ${DIM}${t.detail ?? ''}${RESET}`)
    }
  } catch (e) {
    hadFailure = true
    console.log(`${RED}✗ reference errored:${RESET} ${(e as Error).message}`)
  }

  // Gamed -> at least one test must fail
  try {
    const gamed = gradeRows(pkg, gamedPath, gamedAnswers)
    gamedTests = gamed.tests
    const failed = gamed.tests.filter((t) => !t.passed)
    if (failed.length > 0) {
      console.log(
        `${GREEN}✓ gamed FAILS as intended (${failed.length}/${gamed.totalTests}):${RESET}`
      )
      for (const t of failed)
        console.log(`    ${YELLOW}- ${t.id} (${t.name})${RESET} ${DIM}${t.detail ?? ''}${RESET}`)
    } else {
      hadFailure = true
      console.log(
        `${RED}✗ gamed PASSES — question is under-constrained (does not discriminate)${RESET}`
      )
    }
  } catch (e) {
    hadFailure = true
    console.log(`${RED}✗ gamed errored:${RESET} ${(e as Error).message}`)
  }

  // Discrimination: which checks tell the reference from the gamed design? A check both pass cannot catch this
  // gamed design (it may still catch another wrong design), so a question where most checks are shared is thin.
  if (refTests && gamedTests) {
    const gamedById = new Map(gamedTests.map((t) => [t.id, t.passed]))
    const comparable = refTests.filter((t) => t.passed && gamedById.has(t.id))
    const separating = comparable.filter((t) => gamedById.get(t.id) === false)
    const shared = comparable.filter((t) => gamedById.get(t.id) === true)
    console.log(
      `${DIM}  discrimination: ${separating.length}/${comparable.length} checks separate the reference from the gamed design` +
        `${shared.length ? `; shared (do not separate): ${shared.map((t) => t.id).join(', ')}` : ''}${RESET}`
    )
  }
}

process.exit(hadFailure ? 1 : 0)
