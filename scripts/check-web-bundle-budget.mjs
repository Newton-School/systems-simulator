/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = resolve(projectRoot, 'dist/assets')

const BUNDLE_BUDGETS = [
  {
    prefix: 'index-',
    label: 'main renderer entry',
    maxKb: 575
  },
  {
    prefix: 'simulation.worker-',
    label: 'simulation worker',
    // Runtime-semantic evidence, V2 state machines, and stream lifecycle events run inside this worker.
    maxKb: 425 // 390 - default
  },
  {
    prefix: 'PropertiesPanel-',
    label: 'properties panel lazy chunk',
    maxKb: 165 // 145 - default
  },
  {
    prefix: 'ResultsTray-',
    label: 'results tray lazy chunk',
    maxKb: 110
  }
]

function formatKb(bytes) {
  return (bytes / 1000).toFixed(2)
}

function findAssetByPrefix(files, prefix) {
  return files.find((file) => file.startsWith(prefix) && file.endsWith('.js')) ?? null
}

function main() {
  const assetFiles = readdirSync(assetsDir)
  const failures = []

  for (const budget of BUNDLE_BUDGETS) {
    const file = findAssetByPrefix(assetFiles, budget.prefix)
    if (!file) {
      failures.push(`Missing asset for budget prefix "${budget.prefix}".`)
      continue
    }

    const fullPath = resolve(assetsDir, file)
    const sizeBytes = statSync(fullPath).size
    const sizeKb = sizeBytes / 1000
    const overBudget = sizeKb > budget.maxKb

    console.log(
      `${budget.label}: ${file} ${formatKb(sizeBytes)} kB / ${budget.maxKb.toFixed(2)} kB budget`
    )

    if (overBudget) {
      failures.push(
        `${budget.label} exceeded budget by ${(sizeKb - budget.maxKb).toFixed(2)} kB (${formatKb(sizeBytes)} kB).`
      )
    }
  }

  if (failures.length > 0) {
    console.error('\nBundle budget check failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exitCode = 1
    return
  }

  console.log('\nBundle budget check passed.')
}

main()
