import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { parseQuestionPackage, type QuestionPackage } from '../src/engine/analysis/question'
import { conceptCardForType } from '../src/engine/classroom/conceptCards'
import { classroomReadiness } from '../src/engine/classroom/readiness'
import type { TopologyJSON } from '../src/engine/core/types'

type Check = { passed: boolean; reason: string }
type Classification = 'ready' | 'needs-givens' | 'architect-only' | 'invalid'

interface Row {
  id: string
  title: string
  path: string
  q1: Check
  q2: Check
  classification: Classification
}

const VISIBLE_METRICS = new Set([
  'summary.errorRate',
  'summary.throughput',
  'perNode.maxUtilization',
  'topology.totalNodes',
  'topology.totalEdges',
  'topology.totalWorkers'
])

function questionFiles(path: string): string[] {
  const absolute = resolve(path)
  if (!statSync(absolute).isDirectory()) return [absolute]
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const child = resolve(absolute, entry.name)
      if (entry.isDirectory()) return questionFiles(child)
      return entry.name === 'question.json' || entry.name.endsWith('.question-package.json')
        ? [child]
        : []
    })
    .sort()
}

function q2VisibleEvidence(question: QuestionPackage): Check {
  if ((question.classroom?.checks?.length ?? 0) > 0) {
    return { passed: true, reason: 'Uses the dedicated Classroom check set.' }
  }
  const hiddenMetrics = question.rubric.checks
    .filter((check) => check.kind !== 'execution' && !VISIBLE_METRICS.has(check.metric))
    .map((check) => check.metric)
  const hiddenSemantic = (question.semanticCriteria ?? [])
    .filter(
      (criterion) =>
        !['componentPresence', 'placement', 'guardedPath', 'fanout'].includes(criterion.kind)
    )
    .map((criterion) => criterion.kind)
  const hiddenInvariants = question.suite.cases
    .flatMap((testCase) => testCase.invariants ?? [])
    .filter((invariant) => !/^perNode\.maxUtilization\s*<=/.test(invariant.condition))
    .map((invariant) => invariant.id)
  const hidden = [...new Set([...hiddenMetrics, ...hiddenSemantic, ...hiddenInvariants])]
  return hidden.length === 0
    ? { passed: true, reason: 'Authored checks depend only on visible Classroom evidence.' }
    : { passed: false, reason: `Depends on hidden evidence: ${hidden.join(', ')}.` }
}

function architectBoundary(question: QuestionPackage, file: string): string {
  const topologyPath = resolve(dirname(file), 'reference-topology.json')
  const unsupported = new Set<string>()
  if (existsSync(topologyPath)) {
    const topology = JSON.parse(readFileSync(topologyPath, 'utf8')) as TopologyJSON
    for (const node of topology.nodes)
      if (!conceptCardForType(node.type)) unsupported.add(node.type)
  }
  const evidence = q2VisibleEvidence(question)
  return (
    [
      unsupported.size > 0 ? `unsupported cards: ${[...unsupported].join(', ')}` : '',
      evidence.passed ? '' : evidence.reason.replace(/\.$/, '')
    ]
      .filter(Boolean)
      .join('; ') || 'Explicitly restricted pending a curriculum-authored Classroom contract.'
  )
}

function audit(file: string): Row {
  try {
    const question = parseQuestionPackage(JSON.parse(readFileSync(file, 'utf8')))
    const allowsClassroom = question.classroom?.abstractions?.includes('classroom') ?? true
    if (!allowsClassroom) {
      return {
        id: question.id,
        title: question.title,
        path: file,
        q1: { passed: false, reason: `Architect-only: ${architectBoundary(question, file)}` },
        q2: q2VisibleEvidence(question),
        classification: 'architect-only'
      }
    }
    const readiness = classroomReadiness(question)
    const q1: Check = readiness.ready
      ? { passed: true, reason: 'Solvable using registered Classroom controls.' }
      : { passed: false, reason: readiness.reason }
    const q2 = q2VisibleEvidence(question)
    return {
      id: question.id,
      title: question.title,
      path: file,
      q1,
      q2,
      classification:
        q1.passed && q2.passed ? 'ready' : q2.passed ? 'needs-givens' : 'architect-only'
    }
  } catch (error) {
    return {
      id: basename(dirname(file)),
      title: basename(file),
      path: file,
      q1: { passed: false, reason: error instanceof Error ? error.message : String(error) },
      q2: { passed: false, reason: 'Package did not parse.' },
      classification: 'invalid'
    }
  }
}

function markdown(rows: Row[]): string {
  const counts = Object.fromEntries(
    (['ready', 'needs-givens', 'architect-only', 'invalid'] as const).map((value) => [
      value,
      rows.filter((row) => row.classification === value).length
    ])
  )
  const body = rows
    .map(
      (row) =>
        `| ${row.id} | ${row.classification} | ${row.q1.passed ? 'Pass' : 'Fail'} — ${row.q1.reason} | ${row.q2.passed ? 'Pass' : 'Fail'} — ${row.q2.reason} |`
    )
    .join('\n')
  return `# Classroom Question-Bank Readiness

Generated by \`scripts/audit-classroom-readiness.ts\` on 2026-10-15.

- Ready: ${counts.ready}
- Needs givens/card contract: ${counts['needs-givens']}
- Architect only: ${counts['architect-only']}
- Invalid: ${counts.invalid}

Q1 means the question is solvable using only visible Classroom controls. Q2 means
all scored evidence remains visible after Classroom removes engine configuration.

| Question | Classification | Q1 | Q2 |
| --- | --- | --- | --- |
${body}
`
}

const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const output = outputIndex >= 0 ? args.splice(outputIndex, 2)[1] : undefined
if (args.length === 0) {
  console.error(
    'Usage: tsx scripts/audit-classroom-readiness.ts <file-or-directory>... [--output report.md]'
  )
  process.exit(2)
}
const rows = args.flatMap(questionFiles).map(audit)
const report = markdown(rows)
if (output) writeFileSync(resolve(output), report)
else process.stdout.write(report)
if (rows.some((row) => row.classification === 'invalid')) process.exitCode = 1
