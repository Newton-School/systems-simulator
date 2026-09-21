import {
  compileQuestionPackageToNewtonRows,
  type CompiledNewtonQuestionRows,
  type NewtonTestCaseRowSpec
} from './newtonQuestionRows'
import type { QuestionPackage } from './question'

export const ASSIGNMENT_SIMULATOR_URL =
  'https://systems-simulator.newtonschool.co/?host=newton' as const

export interface DjangoQuestionFields {
  question_type: 'GAME'
  question_title: string
  question_text: string
  initial_game_state: CompiledNewtonQuestionRows['initialGameState']
}

export interface DjangoQuestionRow {
  order: number
  title: string
  hidden: false
  input: NewtonTestCaseRowSpec
  output: ''
}

export interface DjangoQuestionExport {
  fields: DjangoQuestionFields
  rows: DjangoQuestionRow[]
  adminGuideMarkdown: string
}

function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function buildDjangoAssignmentGuide(
  question: QuestionPackage,
  compiled: CompiledNewtonQuestionRows = compileQuestionPackageToNewtonRows(question)
): string {
  const parts = [
    `# Django Admin Setup: ${question.title}`,
    '',
    'This authoring shape is for Newton assignment mode only.',
    'Use it when the simulator is embedded through the generic GAME iframe with `?host=newton`.',
    '',
    '## Frontend contract',
    `- GAME iframe URL: \`${ASSIGNMENT_SIMULATOR_URL}\``,
    '- Newton-hosted assignment mode renders `question_text` as Django HTML.',
    '- Immutable simulator config is rebuilt from the ordered test-case rows below.',
    '- Newton-hosted assignment mode hides topology `Open` / `Save` actions.',
    '',
    '## Django fields',
    '- `question_type`: `GAME`',
    `- \`question_title\`: \`${question.title}\``,
    '- `question_text`:',
    '```html',
    compiled.questionTextHtml,
    '```',
    '- `initial_game_state`:',
    '```json',
    jsonBlock(compiled.initialGameState),
    '```',
    '- `initial_game_state` must stay mutable-only. Do not paste the full `question.json` here.',
    '',
    '## Test-case mapping rules',
    '- Create the rows in the exact order shown below.',
    '- For every row: `hidden = false`, `output = ""`, `output_file = empty`.',
    '- Paste each JSON block into the Django `input` field exactly as shown.',
    ''
  ]

  for (const row of compiled.rows) {
    parts.push(`## Row ${row.order}`)
    parts.push(`- \`title\`: \`${row.title}\``)
    parts.push('- `input`:')
    parts.push('```json')
    parts.push(jsonBlock(row.spec))
    parts.push('```')
    parts.push('')
  }

  return `${parts.join('\n')}\n`
}

export function buildDjangoQuestionExport(
  question: QuestionPackage,
  compiled: CompiledNewtonQuestionRows = compileQuestionPackageToNewtonRows(question)
): DjangoQuestionExport {
  return {
    fields: {
      question_type: 'GAME',
      question_title: compiled.questionTitle,
      question_text: compiled.questionTextHtml,
      initial_game_state: compiled.initialGameState
    },
    rows: compiled.rows.map((row) => ({
      order: row.order,
      title: row.title,
      hidden: row.hidden,
      input: row.spec,
      output: row.output
    })),
    adminGuideMarkdown: buildDjangoAssignmentGuide(question, compiled)
  }
}
