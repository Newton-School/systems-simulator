import { isDeepStrictEqual } from 'node:util'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { auditSimulatorQuestion } from './audit-simulator-question'
import { compileQuestionAuthoringPreview } from '../src/engine/analysis/questionAuthoringCompiler'
import { parseQuestionAuthoringProject } from '../src/engine/analysis/questionAuthoringProject'
import { gradeAttempt, parseQuestionPackage } from '../src/engine/analysis/question'
import { runSimulation } from '../src/engine/runSimulation'
import type { TopologyJSON } from '../src/engine/core/types'
import { TopologyJSONSchema, validateTopology } from '../src/engine/validation/validator'
import { conceptCardForType } from '../src/engine/classroom/conceptCards'
import { compileClassroomTopology } from '../src/engine/classroom/compileClassroom'

const examples = resolve(process.cwd(), 'skills/simulator-question-author/examples')
const root = resolve(examples, 'quickcart')

function json(name: string): unknown {
  return JSON.parse(readFileSync(resolve(root, name), 'utf8'))
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const project = parseQuestionAuthoringProject(
  json('quickcart-flash-sale.simulator-question-project.json')
)
const authoredPackage = parseQuestionPackage(json('quickcart-flash-sale.question-package.json'))
const solution = TopologyJSONSchema.parse(
  json('quickcart-flash-sale.solution-topology.json')
) as TopologyJSON

const preview = compileQuestionAuthoringPreview(project)
invariant(preview.status === 'ready', `Question Studio compile blocked: ${JSON.stringify(preview)}`)
invariant(
  isDeepStrictEqual(preview.questionPackage, authoredPackage),
  'The bundled question package is not the exact output of the bundled Question Studio project.'
)

const topologyValidation = validateTopology(solution)
invariant(
  topologyValidation.valid,
  `Reference topology is invalid: ${JSON.stringify(topologyValidation)}`
)

const passing = gradeAttempt(authoredPackage, solution, runSimulation)
invariant(passing.contract.allPassed, 'The bundled reference solution does not pass every check.')

const nearMiss: TopologyJSON = structuredClone(solution)
nearMiss.nodes = nearMiss.nodes.filter((node) => node.id !== 'srv-13')
nearMiss.edges = nearMiss.edges.filter(
  (edge) => edge.source !== 'srv-13' && edge.target !== 'srv-13'
)
const failing = gradeAttempt(authoredPackage, nearMiss, runSimulation)
invariant(!failing.contract.allPassed, 'The 12-server near miss unexpectedly passed.')
const headroom = failing.graded.cases
  .flatMap((testCase) => testCase.rubric?.checks ?? [])
  .find((check) => check.id === 'rubric-check-2')
invariant(headroom?.passed === false, 'The near miss did not fail the intended headroom check.')

const l4Variant: TopologyJSON = structuredClone(solution)
const balancer = l4Variant.nodes.find((node) => node.id === 'lb')
invariant(balancer, 'Reference topology has no load balancer.')
balancer.type = 'load-balancer-l4'
balancer.label = 'Load Balancer L4'
const l4Grade = gradeAttempt(authoredPackage, l4Variant, runSimulation)
invariant(l4Grade.contract.allPassed, 'The generic load-balancer contract rejected the L4 subtype.')

// Classroom mode: the same answer must hold when the design is rebuilt from the
// question's givens — 13 servers (or one server ×13) pass, 12 fail on headroom.
const classroom = { abstraction: 'classroom' as const }
invariant(authoredPackage.classroom, 'The QuickCart example has no classroom block.')
invariant(
  gradeAttempt(authoredPackage, solution, runSimulation, [], classroom).contract.allPassed,
  'The reference solution does not pass in Classroom mode.'
)
const fleetOfOne: TopologyJSON = structuredClone(solution)
const keptServer = fleetOfOne.nodes.find((node) => node.id === 'srv-01')
invariant(keptServer, 'Reference topology has no srv-01.')
keptServer.resources = { instanceCount: 13 }
fleetOfOne.nodes = fleetOfOne.nodes.filter(
  (node) => node.type !== 'microservice' || node.id === 'srv-01'
)
fleetOfOne.edges = fleetOfOne.edges.filter((edge) =>
  fleetOfOne.nodes.some((node) => node.id === edge.target)
)
invariant(
  gradeAttempt(authoredPackage, fleetOfOne, runSimulation, [], classroom).contract.allPassed,
  'One server ×13 does not pass in Classroom mode.'
)
const classroomNearMiss = gradeAttempt(authoredPackage, nearMiss, runSimulation, [], classroom)
invariant(
  classroomNearMiss.contract.tests.some(
    (test) => !test.passed && test.name === 'Every server stays at or below 80% utilization'
  ),
  'The 12-server near miss did not fail the Classroom headroom check.'
)

// Generalization guard: Classroom authoring must not quietly collapse back to
// the QuickCart trio. Exercise the registry and compiler with non-QuickCart
// front-door, async, cache and storage families.
const generalizedTypes = [
  'api-gateway',
  'cdn',
  'batch-worker',
  'in-memory-cache',
  'relational-db',
  'nosql-db',
  'queue'
] as const
for (const type of generalizedTypes) {
  invariant(conceptCardForType(type), `Classroom generalization card missing for ${type}.`)
}
const generalizedTopology: TopologyJSON = {
  ...structuredClone(solution),
  id: 'classroom-generalization-smoke',
  name: 'Classroom generalization smoke',
  nodes: [
    structuredClone(solution.nodes.find((node) => node.id === 'src')!),
    {
      id: 'gateway',
      type: 'api-gateway',
      category: 'network-and-edge',
      role: 'router',
      label: 'API Gateway',
      position: { x: 200, y: 0 }
    },
    {
      id: 'service',
      type: 'microservice',
      category: 'compute',
      role: 'processor',
      label: 'Service',
      position: { x: 400, y: 0 }
    },
    {
      id: 'cache',
      type: 'in-memory-cache',
      category: 'storage-and-data',
      role: 'storage',
      label: 'Cache',
      position: { x: 600, y: 0 }
    },
    {
      id: 'database',
      type: 'relational-db',
      category: 'storage-and-data',
      role: 'storage',
      label: 'Database',
      position: { x: 800, y: 0 }
    },
    {
      id: 'queue',
      type: 'queue',
      category: 'messaging-and-streaming',
      role: 'storage',
      label: 'Queue',
      position: { x: 1000, y: 0 }
    },
    {
      id: 'worker',
      type: 'batch-worker',
      category: 'compute',
      role: 'processor',
      label: 'Worker',
      position: { x: 1200, y: 0 }
    }
  ],
  edges: ['src', 'gateway', 'service', 'cache', 'database', 'queue'].map((source, index) => {
    const target = ['gateway', 'service', 'cache', 'database', 'queue', 'worker'][index]
    const base = structuredClone(solution.edges[0])
    return { ...base, id: `${source}-to-${target}`, source, target }
  }),
  workload: { ...structuredClone(solution.workload!), sourceNodeId: 'src', baseRps: 100 }
}
const generalizedCompile = compileClassroomTopology(generalizedTopology, {
  settings: {
    givens: {
      microservice: { capacityRps: 1000 },
      'in-memory-cache': { capacityRps: 2000 },
      'relational-db': { capacityRps: 1500 },
      'batch-worker': { capacityRps: 1000 }
    }
  },
  workload: { pattern: 'constant', baseRps: 100 }
})
invariant(
  generalizedCompile.issues.length === 0,
  `Non-QuickCart Classroom path failed to compile: ${JSON.stringify(generalizedCompile.issues)}`
)
invariant(
  generalizedCompile.topology.nodes.find((node) => node.id === 'cache')?.role === 'storage' &&
    generalizedCompile.topology.nodes.find((node) => node.id === 'queue')?.role === 'storage',
  'Classroom generalization lost storage roles.'
)

invariant(
  authoredPackage.suite.visibleToStudent === false,
  'Private grading cases are learner-visible.'
)
invariant(authoredPackage.suite.dryRunCase, 'The package has no public dry run.')
invariant(
  !authoredPackage.suite.dryRunCase.invariants?.length &&
    !authoredPackage.suite.dryRunCase.faults?.length &&
    !authoredPackage.suite.dryRunCase.experiment,
  'The public dry run leaks private invariants, faults, or experiment details.'
)

// Every bundled example must stay inside the grading budget and clear the
// Studio audit, so the skill never ships an example it would itself reject.
const seriesRoot = resolve(examples, 'food-delivery-series')
const audited = [
  { directory: root, slug: 'quickcart-flash-sale' },
  ...readdirSync(seriesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = resolve(seriesRoot, entry.name)
      const project = readdirSync(directory).find((name) =>
        name.endsWith('.simulator-question-project.json')
      )
      invariant(project, `${entry.name} has no Question Studio project.`)
      return { directory, slug: project.replace('.simulator-question-project.json', '') }
    })
]
const audits = audited.map(({ directory, slug }) => auditSimulatorQuestion(directory, slug))
for (const audit of audits) {
  invariant(
    audit.passed,
    `${audit.slug} fails the question audit: ${audit.findings.map((f) => f.message).join('; ')}`
  )
}

console.log(
  JSON.stringify(
    {
      audited: audits.map((audit) => `${audit.slug}: ${JSON.stringify(audit.tally)}`),
      project: 'parsed',
      compiler: 'exact package match',
      topology: 'valid',
      reference: 'passed',
      nearMiss: 'failed headroom as intended',
      familyVariant: 'L4 passed generic load-balancer contract',
      classroom: '13 servers and one server ×13 pass; 12 fail headroom',
      classroomFamilies:
        'gateway, CDN, worker, cache, SQL, NoSQL and queue cards compile outside QuickCart',
      publicDryRun: 'contains no private grading mechanics'
    },
    null,
    2
  )
)
