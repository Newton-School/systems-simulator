import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AUTHORING_COMPONENT_CAPABILITIES,
  RUBRIC_METRIC_CAPABILITIES,
  SEMANTIC_AUTHORING_CAPABILITIES,
  STRUCTURAL_AUTHORING_CAPABILITIES
} from '../src/engine/analysis/authoringCapabilities'
import {
  BUILDER_NODE_CLASS_IDS,
  RUNTIME_TEMPLATE_IDS,
  TRAIT_PACK_IDS
} from '../src/engine/analysis/builderPolicy'

const output = resolve(
  process.cwd(),
  'skills/simulator-question-author/references/capability-snapshot.json'
)

const capabilityData = {
  snapshotVersion: '2026-10-13',
  sources: [
    'src/engine/analysis/authoringCapabilities.ts',
    'src/engine/analysis/builderPolicy.ts',
    'src/engine/catalog/paletteTemplates.ts'
  ],
  componentFamilies: {
    'load-balancer': ['load-balancer-l4', 'load-balancer-l7']
  },
  components: AUTHORING_COMPONENT_CAPABILITIES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    category: entry.category,
    supportTier: entry.supportTier,
    aliases: entry.aliases
  })),
  metrics: RUBRIC_METRIC_CAPABILITIES.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    group: entry.group,
    unit: entry.unit,
    evidenceModes: entry.evidenceModes,
    operators: entry.operators,
    ...(entry.description ? { description: entry.description } : {})
  })),
  structuralRules: STRUCTURAL_AUTHORING_CAPABILITIES.map((entry) => entry.id),
  semanticCriteria: SEMANTIC_AUTHORING_CAPABILITIES.map((entry) => entry.id),
  workloadPatterns: ['constant', 'poisson', 'bursty', 'diurnal', 'spike', 'sawtooth', 'replay'],
  chaosExperimentPresets: ['az-outage', 'db-failover', 'cache-stampede', 'traffic-spike'],
  builderPolicy: {
    nodeClasses: BUILDER_NODE_CLASS_IDS,
    runtimeTemplates: RUNTIME_TEMPLATE_IDS,
    traitPacks: TRAIT_PACK_IDS
  }
}

const canonical = JSON.stringify(capabilityData)
const document = {
  ...capabilityData,
  digest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}
const rendered = `${JSON.stringify(document, null, 2)}\n`

if (process.argv.includes('--check')) {
  const existing = readFileSync(output, 'utf8')
  if (existing !== rendered) {
    console.error('Simulator Question Author capability snapshot is stale.')
    process.exit(1)
  }
  console.log('Simulator Question Author capability snapshot is current.')
} else if (process.argv.includes('--stdout')) {
  process.stdout.write(rendered)
} else {
  writeFileSync(output, rendered)
  console.log(`Updated ${output}`)
}
