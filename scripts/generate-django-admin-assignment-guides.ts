#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
export { buildDjangoAssignmentGuide } from '../src/engine/analysis/djangoQuestionExport'
import { buildDjangoAssignmentGuide } from '../src/engine/analysis/djangoQuestionExport'
import { parseQuestionPackage } from '../src/engine/analysis/question'

const DEFAULT_QUESTION_ROOT = path.resolve(
  process.cwd(),
  'ns-simulator-docs/examples/question-bank'
)
const GUIDE_FILE_NAME = 'django-admin-assignment.md'
async function questionDirectories(rootDirectory: string): Promise<string[]> {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

async function main(): Promise<void> {
  const rootDirectory = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_QUESTION_ROOT

  for (const questionDirectory of await questionDirectories(rootDirectory)) {
    const questionPath = path.join(questionDirectory, 'question.json')
    const question = parseQuestionPackage(JSON.parse(await fs.readFile(questionPath, 'utf8')))
    const guidePath = path.join(questionDirectory, GUIDE_FILE_NAME)
    await fs.writeFile(guidePath, buildDjangoAssignmentGuide(question), 'utf8')
    console.log(`wrote ${path.relative(process.cwd(), guidePath)}`)
  }
}

if (process.argv[1]?.endsWith('generate-django-admin-assignment-guides.ts')) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
