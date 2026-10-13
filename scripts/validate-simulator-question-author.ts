import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileQuestionAuthoringPreview } from '../src/engine/analysis/questionAuthoringCompiler'
import { parseQuestionAuthoringProject } from '../src/engine/analysis/questionAuthoringProject'
import { gradeAttempt, parseQuestionPackage } from '../src/engine/analysis/question'
import { runSimulation } from '../src/engine/runSimulation'
import type { TopologyJSON } from '../src/engine/core/types'
import { TopologyJSONSchema, validateTopology } from '../src/engine/validation/validator'

const root = resolve(process.cwd(), 'skills/simulator-question-author/examples/quickcart')

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

console.log(
  JSON.stringify(
    {
      project: 'parsed',
      compiler: 'exact package match',
      topology: 'valid',
      reference: 'passed',
      nearMiss: 'failed headroom as intended',
      familyVariant: 'L4 passed generic load-balancer contract',
      publicDryRun: 'contains no private grading mechanics'
    },
    null,
    2
  )
)
