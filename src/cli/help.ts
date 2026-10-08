import type { Palette } from './ansi'

export const CLI_COMMANDS = [
  'run',
  'validate',
  'lint',
  'cost',
  'compare',
  'evaluate',
  'grade'
] as const
export type CliCommand = (typeof CLI_COMMANDS)[number]

export function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value)
}

const EXIT_CODES = `Exit codes
  0  success (lint: no critical findings; question: passed)
  1  usage or input error (unknown flag, missing/unreadable file, invalid topology)
  2  check failed (lint found a critical issue, validate found errors, grading failed)
  3  invalid submission contract (evaluate question / question-batch)
  4  evaluation error contract (evaluate question / question-batch)`

export function mainUsage(c: Palette, version: string): string {
  return `
${c.bold}sim${c.reset} - the System Design Simulator command line (sim cli) ${c.dim}v${version}${c.reset}

${c.bold}Usage${c.reset}
  sim <command> [options]
  npm run sim -- <command> [options]     ${c.dim}(same thing, from a checkout)${c.reset}

${c.bold}Commands${c.reset}
  run <topology.json>              Simulate a topology and print metrics (--live for a live view)
  validate <topology.json>         Check a topology against the schema; print errors and warnings
  lint <topology.json>             Detect architectural anti-patterns (exit 2 on critical findings)
  cost <topology.json>             Per-component $/hr breakdown (--run for measured, post-run figures)
  compare <a.json> <b.json>        Simulate two designs with the same seed and diff them
  evaluate ...                     Headless suites, scenario batches and question grading
  grade <question> <topology>      Alias for: evaluate question

  sim <command> --help             Options for one command
  sim <topology.json>              Shorthand for: sim run <topology.json>

Every command that prints a report accepts --json for machine-readable output.

${EXIT_CODES}
`
}

const HELP: Record<CliCommand, (c: Palette) => string> = {
  run: (c) => `
${c.bold}sim run${c.reset} <topology.json> [options]

Simulates the topology with the discrete-event engine and prints a summary,
latency percentiles and decomposition, failure locus, per-node metrics, SLO
breaches and Little's Law checks. Progress is drawn on stderr.

${c.bold}Options${c.reset}
  --json              Print the full SimulationOutput as JSON to stdout
  --verdict           Print the SimulationVerdict as JSON to stdout
  --output <file>     Write the JSON (output or verdict) to a file instead
  --live              Live per-node table while the engine runs (terminal only;
                      degrades to plain progress lines when stderr is not a TTY).
                      Keys: q stops early and prints results, p pauses/resumes.
  --seed <seed>       Override global.seed
  --duration-ms <n>   Override global.simulationDuration (milliseconds)
  -h, --help          Show this message

${c.bold}Examples${c.reset}
  sim run order-topology.json
  sim run order-topology.json --live
  sim run order-topology.json --json | jq '.summary'
  sim run order-topology.json --verdict --seed 7 --duration-ms 30000
`,
  validate: (c) => `
${c.bold}sim validate${c.reset} <topology.json> [--json]

Validates the topology file against the schema and semantic rules. Prints each
error (with its JSON path) and each non-fatal warning.

${c.bold}Options${c.reset}
  --json              Print { valid, topologyId, errors, warnings } as JSON
  -h, --help          Show this message

Exits 0 when valid, 2 when the topology has errors, 1 when the file is unreadable.
`,
  lint: (c) => `
${c.bold}sim lint${c.reset} <topology.json> [--json]

Runs the anti-pattern detector (single points of failure, sync calls to slow
dependencies, shared databases, missing load balancers, cache in front of a load
balancer, queues without consumers, excessive retries) and reports topology
validation warnings alongside. No simulation is run.

${c.bold}Options${c.reset}
  --json              Print the LintReport as JSON
  -h, --help          Show this message

Exits 2 when any critical anti-pattern is found, 0 otherwise (warnings alone
pass), 1 when the file is unreadable or the topology is invalid.
`,
  cost: (c) => `
${c.bold}sim cost${c.reset} <topology.json> [options]

Prints the infrastructure cost in USD/hour per component and in total, from the
instance catalog (provisioned), per-request pricing (consumption) and per-GB
egress (volume). Without --run, traffic-dependent lines are estimates from the
configured workload and are marked with ~.

${c.bold}Options${c.reset}
  --run               Simulate first and price consumption/egress from the run
  --mode <m>          With --run: auto (default), discrete or analytic
  --json              Print the CostReport as JSON
  -h, --help          Show this message

Pricing is a single built-in catalog (AWS-proportional); there is no per-cloud
provider switch.
`,
  compare: (c) => `
${c.bold}sim compare${c.reset} <a.json> <b.json> [options]

Simulates both designs with the same seed and prints a metric-by-metric diff
(latency percentiles, throughput, error rate, successful requests, cost),
per-component utilization for shared components, and a one-line summary.
Differences within 1% are reported as ties. Delta is B relative to A.

${c.bold}Options${c.reset}
  --seed <seed>       Seed for both runs (default: design A's global.seed)
  --mode <m>          auto (default; analytic model for very heavy load),
                      discrete or analytic
  --json              Print the CompareReport as JSON
  -h, --help          Show this message

Exits 0 when both designs ran, 1 when either file is unreadable or invalid.
`,
  evaluate: (c) => `
${c.bold}sim evaluate${c.reset} - headless evaluation contracts (JSON on stdout)

${c.bold}Usage${c.reset}
  sim evaluate <suite.json> [--rubric <rubric.json>] [--output <file>]
  sim evaluate <topology.json> --scenarios <scenarios.json> [--timeout-ms <n>] [--output <file>]
  sim evaluate question <question.json> <student-topology.json> [options]
  sim evaluate question-batch <batch.json> [--timeout-ms <n>] [--require-pass] [options]

${c.bold}Options${c.reset}
  --output <file>       Write the JSON to a file instead of stdout
  --rubric <file>       (suite) Grade each case's verdict against a rubric
  --scenarios <file>    Run one base topology under multiple overrides
  --timeout-ms <n>      (scenarios/question-batch) Per-row wall-clock timeout
  --attempt-id <id>     (question) Stable attempt id on the output contract
  --submission-id <id>  (question) Stable submission id on the output contract
  --evaluated-at <ts>   (question/batch/scenarios) Explicit ISO timestamp
  --require-pass        (question-batch) Exit 2 when any valid attempt fails
  -h, --help            Show this message

${c.bold}Suite mode${c.reset}
  A suite is { "name"?, "cases": [{ "id", "topology": <path|object>, "global"?, "workload"? }] }.
  Prints an EvaluationBatch of SimulationVerdicts; with --rubric, a
  GradedEvaluationBatch. Exits 1 if any case fails to run or does not pass.

${c.bold}Scenario mode${c.reset}
  A scenarios file is { "submissionId"?, "topologyId"?, "evaluatedAt"?, "timeoutMs"?,
  "scenarios": [{ "id", "name"?, "overrides"?: { "global"?, "workload"?, "faults"? } }] }.
  Scenarios run in isolated subprocesses; failures are isolated per row and the
  command exits 0 unless the base topology or the scenarios file is invalid.

${c.bold}Question mode${c.reset}
  Grades one student topology against a QuestionPackage and prints a versioned
  QuestionEvaluationContract. Invalid student input becomes an invalid_submission
  contract instead of a crash.

${c.bold}Question-batch mode${c.reset}
  A batch file is { "evaluatedAt"?, "timeoutMs"?, "attempts": [{ "attemptId"?,
  "submissionId"?, "question": <path|object>, "topology": <path|object> }] }.
  Each attempt yields an isolated QuestionEvaluationContract row.

${EXIT_CODES}
`,
  grade: (c) => `
${c.bold}sim grade${c.reset} <question.json> <student-topology.json> [options]

Alias for: sim evaluate question <question.json> <student-topology.json>
Accepts the same --output, --attempt-id, --submission-id and --evaluated-at options.

${EXIT_CODES}
`
}

export function commandHelp(command: CliCommand, c: Palette): string {
  return HELP[command](c)
}
