#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const [directory, slug] = process.argv.slice(2)
if (!directory || !slug) {
  console.error('Usage: node scripts/validate-artifacts.mjs <output-directory> <slug>')
  process.exit(2)
}

const core = spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, 'validate-core.mjs'), directory, slug],
  { stdio: 'inherit' }
)
if (core.status !== 0) process.exit(core.status ?? 1)

const question = JSON.parse(
  readFileSync(resolve(directory, `${slug}.question-package.json`), 'utf8')
)
const lecture = readFileSync(resolve(directory, `${slug}.lecture-sheet.md`), 'utf8')
if (lecture.length < 200) throw new Error('Lecture sheet is missing or too short.')
if (!lecture.includes(question.title)) throw new Error('Lecture sheet does not name the question.')

const normalizedLecture = lecture.replaceAll(',', '')
for (const givens of Object.values(question.classroom?.givens ?? {})) {
  for (const value of [
    givens.capacityRps,
    givens.costPerHour,
    givens.latencyMs,
    givens.cacheHitRate,
    givens.readCapacityRps,
    givens.writeCapacityRps
  ].filter(Number.isFinite)) {
    if (!normalizedLecture.includes(String(value))) {
      throw new Error(`Lecture sheet is missing Classroom given ${value}.`)
    }
  }
}
const objectiveIds = new Set(
  (question.classroom?.objectives ?? []).map((objective) => objective.id)
)
for (const check of (question.classroom?.checks ?? []).filter(
  (entry) => entry.severity !== 'feedback'
)) {
  if (objectiveIds.size > 0 && !objectiveIds.has(check.objectiveId)) {
    throw new Error(`Scored Classroom check '${check.id}' is not tied to an objective.`)
  }
}
for (const misconception of question.classroom?.misconceptions ?? []) {
  if (!misconception.message || !misconception.detect) {
    throw new Error(`Misconception '${misconception.id}' needs a message and detector.`)
  }
}
for (const knob of question.classroom?.guidedKnobs ?? []) {
  if (!objectiveIds.has(knob.objectiveId)) {
    throw new Error(`Guided knob '${knob.path}' is not tied to an objective.`)
  }
}
console.log(`Validated ${slug}.lecture-sheet.md against the Classroom givens.`)
