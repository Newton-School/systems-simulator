#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type -- standalone generator */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'docs/system-design-concept-taxonomy.md')
const outputPath = resolve(root, 'src/engine/classroom/systemDesignConceptRegistry.generated.ts')
const skillReferencePath = resolve(
  root,
  'skills/classroom-question-author/references/system-design-concepts.md'
)

const source = await readFile(sourcePath, 'utf8')
const logicalLines = source.replace(/\r?\n {2,}/g, ' ').split(/\r?\n/)
const concepts = []
let domain = null

const CLASSROOM_RECIPES = {
  'SC-01': [
    'size',
    ['users', 'load-balancer', 'server'],
    ['copies'],
    ['serves-all-traffic', 'within-target-utilization', 'right-sized']
  ],
  'SC-05': [
    'size',
    ['users', 'load-balancer', 'server'],
    ['copies'],
    ['serves-all-traffic', 'within-target-utilization', 'right-sized']
  ],
  'SC-06': [
    'size',
    ['users', 'load-balancer', 'server'],
    ['copies'],
    ['serves-all-traffic', 'within-target-utilization', 'right-sized']
  ],
  'SC-08': [
    'size',
    ['users', 'load-balancer', 'server'],
    ['copies'],
    ['serves-all-traffic', 'within-target-utilization', 'right-sized']
  ],
  'AS-05': [
    'connect',
    ['users', 'server', 'queue', 'worker'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ],
  'NET-04': [
    'place',
    ['users', 'api-gateway', 'server'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ],
  'NET-05': [
    'place',
    ['users', 'load-balancer', 'server'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ],
  'NET-07': [
    'place',
    ['users', 'cdn', 'server'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ],
  'CMP-02': [
    'size',
    ['users', 'load-balancer', 'server'],
    ['copies'],
    ['serves-all-traffic', 'within-target-utilization', 'right-sized']
  ],
  'CACHE-01': [
    'place',
    ['users', 'server', 'cache', 'sql-database'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ],
  // CACHE-10 (hit-rate economics) has no Classroom recipe on purpose: the analytic
  // path ignores cache hit rates and the per-request path doesn't match the napkin
  // answer, so hit-rate arithmetic would be graded on fabricated evidence. It routes
  // to Guided until Classroom can honestly simulate it.
  'MSG-01': [
    'connect',
    ['users', 'server', 'queue', 'worker'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ],
  'MSG-02': [
    'connect',
    ['users', 'server', 'queue', 'worker'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ],
  'REL-02': [
    'place',
    ['users', 'load-balancer', 'server'],
    ['place-component', 'connect-components', 'copies'],
    ['traffic-flows-through']
  ],
  'REL-09': [
    'select',
    ['users', 'api-gateway', 'server'],
    ['place-component', 'connect-components'],
    ['traffic-flows-through']
  ]
}

function activityFor(concept) {
  const text = `${concept.title} ${concept.summary}`.toLowerCase()
  if (/estimat|capacity|bandwidth|volume|throughput|economics|cost/.test(text)) return 'estimate'
  if (/failure|incident|debug|diagnos|testing|verification|forensic/.test(text)) return 'diagnose'
  if (/placement|topology|decomposition|partition|shard|replic|routing|architecture/.test(text))
    return 'design'
  if (/versus|trade-off|selection|select|choice|prioriti|classification/.test(text))
    return 'compare'
  if (/config|policy|timeout|retries|limit|quota|consistency|isolation/.test(text))
    return 'configure'
  return 'explain'
}

function fallbackOutcome(surfaces) {
  if (surfaces.includes('G')) return 'guided'
  if (surfaces.includes('A')) return 'architect-handoff'
  return 'external-lab'
}

function authoringRecipe(concept) {
  const classroom = CLASSROOM_RECIPES[concept.id]
  if (classroom) {
    const [activity, recommendedCards, allowedDecisionKinds, compatibleChecks] = classroom
    const needsCapacity = recommendedCards.some((card) =>
      ['server', 'worker', 'cache', 'sql-database', 'nosql-database'].includes(card)
    )
    return {
      outcome: activity === 'size' ? 'classroom-direct' : 'classroom-structural',
      activity,
      objectiveStem: `apply ${concept.title.toLowerCase()} to a visible system-design decision`,
      requiredGivens: [
        'peakRps',
        ...(needsCapacity ? ['componentCapacityRps'] : []),
        ...(activity === 'size' ? ['maxUtilization'] : [])
      ],
      recommendedCards,
      // A sizing lesson usually starts from a blank canvas, so students also place
      // and connect the recommended cards before they choose copy counts.
      allowedDecisionKinds:
        activity === 'size'
          ? [...new Set(['place-component', 'connect-components', ...allowedDecisionKinds])]
          : allowedDecisionKinds,
      compatibleChecks,
      boundary:
        activity === 'size'
          ? 'Grade only stated capacity, copy-count, utilization, and traffic-serving evidence.'
          : 'Grade visible topology and placement only; do not infer unmodeled component behavior.'
    }
  }

  const outcome = fallbackOutcome(concept.surfaces)
  return {
    outcome,
    activity: activityFor(concept),
    objectiveStem: `reason about ${concept.title.toLowerCase()} within its stated model boundary`,
    requiredGivens: [],
    recommendedCards: [],
    allowedDecisionKinds: outcome === 'guided' ? ['guided-knob'] : [],
    compatibleChecks: [],
    boundary:
      outcome === 'guided'
        ? 'Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient.'
        : outcome === 'architect-handoff'
          ? 'Use full scenarios and engine evidence in Architect mode.'
          : 'Use an explanation or external lab until the simulator has honest evidence for this concept.'
  }
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

for (const line of logicalLines) {
  const heading = line.match(/^## (\d+)\. (.+)$/)
  if (heading) {
    domain = { id: `domain-${heading[1]}`, label: heading[2] }
    continue
  }

  const entry = line.match(/^- \*\*([A-Z]+-\d+) \[([CGAX/]+)\] (.+?)\*\*(.*)$/)
  if (!entry || !domain) continue
  const title = entry[3].replace(/[:.]$/, '')
  const detail = entry[4].replace(/^[:.]\s*/, '').trim()
  const concept = {
    id: entry[1],
    slug: slug(title),
    domainId: domain.id,
    domain: domain.label,
    title,
    summary: detail,
    surfaces: entry[2].split('/')
  }
  concepts.push({ ...concept, authoring: authoringRecipe(concept) })
}

if (concepts.length < 300) {
  throw new Error(`Expected at least 300 taxonomy concepts, found ${concepts.length}.`)
}

const ids = new Set()
for (const concept of concepts) {
  if (ids.has(concept.id)) throw new Error(`Duplicate taxonomy concept '${concept.id}'.`)
  ids.add(concept.id)
}

const generated = `/* eslint-disable prettier/prettier -- generated data uses stable JSON formatting */
/**
 * Generated from docs/system-design-concept-taxonomy.md.
 * Run \`npm run generate:system-design-concepts\`; do not edit by hand.
 */
export const SYSTEM_DESIGN_CONCEPTS = ${JSON.stringify(concepts, null, 2)} as const
`

await writeFile(outputPath, generated)
const skillReference = `# Generated System Design Teaching Concepts

Generated by \`scripts/generate-system-design-concept-registry.mjs\` from the
canonical curriculum taxonomy. Do not edit this file by hand.

Use the stable ID in each learning objective. Surfaces are Classroom (C), Guided
(G), Architect (A), and explanation or external lab (X). A surface is a curriculum
recommendation, not proof that the current simulator already implements the concept.

| ID | Domain | Concept | Surfaces | Recommended authoring | Activity |
| --- | --- | --- | --- | --- | --- |
${concepts.map((concept) => `| \`${concept.id}\` | ${concept.domain} | ${concept.title} | ${concept.surfaces.join('/')} | ${concept.authoring.outcome} | ${concept.authoring.activity} |`).join('\n')}
`
await writeFile(skillReferencePath, skillReference)
console.log(`Generated ${concepts.length} system-design concepts.`)
