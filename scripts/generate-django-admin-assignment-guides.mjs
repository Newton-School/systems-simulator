#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_QUESTION_ROOT = path.resolve(
  process.cwd(),
  '../system-design-simulator-questions/questions'
)

const GUIDE_FILE_NAME = 'django-admin-assignment.md'
const ASSIGNMENT_SIMULATOR_URL = 'https://systems-simulator.newtonschool.co/?host=newton'

const SCALE_LABELS = {
  dau: 'DAU',
  mau: 'MAU',
  peakRps: 'Peak RPS',
  readWriteRatio: 'Read / Write'
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value)
}

function labelizeScaleKey(key) {
  if (SCALE_LABELS[key]) {
    return SCALE_LABELS[key]
  }
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase())
}

function formatScaleValue(key, value) {
  if (key === 'readWriteRatio' && typeof value === 'number') {
    return `${value}:${100 - value}`
  }
  return typeof value === 'number' ? formatNumber(value) : String(value)
}

function buildQuestionHtml(prompt) {
  const sections = []
  const paragraphs = String(prompt.text || '')
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  if (paragraphs.length > 0) {
    sections.push(
      ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    )
  }

  if (Array.isArray(prompt.functionalRequirements) && prompt.functionalRequirements.length > 0) {
    sections.push('<h3>Functional Requirements</h3>')
    sections.push('<ul>')
    for (const requirement of prompt.functionalRequirements) {
      sections.push(`  <li>${escapeHtml(requirement)}</li>`)
    }
    sections.push('</ul>')
  }

  if (
    Array.isArray(prompt.nonFunctionalRequirements) &&
    prompt.nonFunctionalRequirements.length > 0
  ) {
    sections.push('<h3>Non-Functional Targets</h3>')
    sections.push('<ul>')
    for (const requirement of prompt.nonFunctionalRequirements) {
      sections.push(`  <li>${escapeHtml(requirement.description)}</li>`)
    }
    sections.push('</ul>')
  }

  const scaleEntries = Object.entries(prompt.scale || {})
  if (scaleEntries.length > 0) {
    sections.push('<h3>Scale</h3>')
    sections.push('<ul>')
    for (const [key, value] of scaleEntries) {
      sections.push(
        `  <li><strong>${escapeHtml(labelizeScaleKey(key))}:</strong> ${escapeHtml(formatScaleValue(key, value))}</li>`
      )
    }
    sections.push('</ul>')
  }

  return sections.join('\n')
}

function buildInitialGameState(question) {
  if (question.scaffold?.type === 'partial' && question.scaffold.topology) {
    return { topology: question.scaffold.topology }
  }
  return {}
}

function buildConfigRow(question) {
  const justify = Array.isArray(question._justify) ? question._justify : []
  return {
    type: 'SIMULATOR_CONFIG',
    configVersion: '1.0',
    questionId: question.id,
    questionVersion: question.version,
    questionType: question.type,
    difficulty: question.difficulty,
    workloadCategory: question.workloadCategory,
    presentationMode: 'raw-html',
    promptSource: 'question_text',
    scaffold: question.scaffold,
    constraints: question.constraints,
    suite: question.suite,
    rubric: {
      id: question.rubric.id,
      passThreshold: question.rubric.passThreshold
    },
    ...(justify.length > 0 ? { justify } : {})
  }
}

function buildRows(question) {
  const rows = [
    {
      order: 1,
      title: `SIMULATOR_CONFIG: ${question.id}`,
      spec: buildConfigRow(question)
    }
  ]

  let order = rows.length + 1
  for (const rule of question.structuralRules || []) {
    rows.push({
      order,
      title: `STRUCTURAL_RULE: ${rule.id}`,
      spec: { type: 'STRUCTURAL_RULE', ...rule }
    })
    order += 1
  }

  for (const criterion of question.semanticCriteria || []) {
    rows.push({
      order,
      title: `SEMANTIC_CRITERION: ${criterion.id}`,
      spec: { type: 'SEMANTIC_CRITERION', ...criterion }
    })
    order += 1
  }

  for (const check of question.rubric?.checks || []) {
    rows.push({
      order,
      title: `RUBRIC_CHECK: ${check.id}`,
      spec: { type: 'RUBRIC_CHECK', ...check }
    })
    order += 1
  }

  return rows
}

function toJsonBlock(value) {
  return JSON.stringify(value, null, 2)
}

function buildGuide(question) {
  const questionHtml = buildQuestionHtml(question.prompt)
  const initialGameState = buildInitialGameState(question)
  const rows = buildRows(question)

  const parts = [
    `# Django Admin Setup: ${question.title}`,
    '',
    'This authoring shape is for Newton assignment mode only.',
    'Use it when the simulator is embedded through the generic GAME iframe with `?host=newton`.',
    'Do not use this shape for standalone/local authoring at `https://systems-simulator.newtonschool.co/`; standalone/local must keep topology open/save available.',
    '',
    '## Frontend contract',
    `- GAME iframe URL: \`${ASSIGNMENT_SIMULATOR_URL}\``,
    '- Newton-hosted assignment mode must render `question_text` as raw Django HTML.',
    '- The frontend translator must rebuild immutable simulator config from the test-case rows below, not from `initial_game_state`.',
    '- Newton-hosted assignment mode must hide topology `Open` / `Save` actions and disable `Ctrl/Cmd+O` and `Ctrl/Cmd+S`.',
    '',
    '## Django fields',
    '- `question_type`: `GAME`',
    `- \`question_title\`: \`${question.title}\``,
    '- `question_text`:',
    '```html',
    questionHtml,
    '```',
    '- `initial_game_state`:',
    '```json',
    toJsonBlock(initialGameState),
    '```',
    '- `initial_game_state` must stay mutable-only. Do not paste the full `question.json` here.',
    '',
    '## Test-case mapping rules',
    '- Create the rows in the exact order shown below.',
    '- For every row: `hidden = false`, `output = ""`, `output_file = empty`.',
    '- Paste each JSON block into the Django `input` field exactly as shown.',
    ''
  ]

  for (const row of rows) {
    parts.push(`## Row ${row.order}`)
    parts.push(`- ` + '`title`' + `: \`${row.title}\``)
    parts.push('- `input`:')
    parts.push('```json')
    parts.push(toJsonBlock(row.spec))
    parts.push('```')
    parts.push('')
  }

  return parts.join('\n')
}

async function readQuestionDirs(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

async function main() {
  const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_QUESTION_ROOT
  const questionDirs = await readQuestionDirs(rootDir)

  for (const questionDir of questionDirs) {
    const questionPath = path.join(questionDir, 'question.json')
    const question = JSON.parse(await fs.readFile(questionPath, 'utf8'))
    const guidePath = path.join(questionDir, GUIDE_FILE_NAME)
    await fs.writeFile(guidePath, `${buildGuide(question)}\n`, 'utf8')
    console.log(`wrote ${path.relative(process.cwd(), guidePath)}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
