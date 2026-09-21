import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildQuestionAuthoringCoverageReport,
  formatQuestionAuthoringCoverageMarkdown,
  type QuestionAuthoringCoverageInput
} from '../src/engine/analysis/authoringCoverage'

const DEFAULT_BANK_DIR = 'ns-simulator-docs/examples/question-bank'

function loadQuestionBank(rootDir: string): QuestionAuthoringCoverageInput[] {
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const questionPath = join(rootDir, entry.name, 'question.json')
      return {
        source: questionPath,
        raw: JSON.parse(readFileSync(questionPath, 'utf8')) as unknown
      }
    })
}

function main(): void {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const rootArg = args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_BANK_DIR
  const rootDir = resolve(process.cwd(), rootArg)
  const report = buildQuestionAuthoringCoverageReport(loadQuestionBank(rootDir))

  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatQuestionAuthoringCoverageMarkdown(report)}\n`
  )

  if (report.totals.parseable !== report.totals.questions) {
    process.exitCode = 1
  }
}

main()
