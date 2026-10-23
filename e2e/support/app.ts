/**
 * Browser helpers. They use accessible names (role + name) that the app already exposes, so no
 * test-only attributes are needed in the product code.
 */
import { expect, type Page } from '@playwright/test'
import type { TopologyJSON } from '../../src/engine/core/types'

export async function openApp(page: Page): Promise<void> {
  // Absolute so it also works when driving an existing Chrome over CDP (no baseURL there).
  await page.goto(`http://localhost:${process.env.E2E_PORT ?? 5290}/`)
  await page.bringToFront()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible()
}

/**
 * Paste a TopologyJSON through More actions > JSON > Import JSON, then close the result dialog.
 * Returns the dialog text (the import summary and any warnings) so a flow can assert on it.
 */
export async function importTopology(page: Page, topology: TopologyJSON): Promise<string> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('button', { name: /^(JSON|TopologyJSON: import.*)$/ }).click()
  await page.getByRole('menuitem', { name: /Import JSON/ }).click()
  await page.getByRole('textbox').fill(JSON.stringify(topology))
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Imported \d+ components?/)).toBeVisible()
  const text = await bodyText(page)
  await page.getByRole('button', { name: 'Done' }).click()
  return text
}

export async function runAndWait(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const details = page.getByRole('button', { name: 'See details' })
  await expect(details).toBeVisible({ timeout: 60_000 })
  await details.click()
  await expect(page.getByText('Success Throughput')).toBeVisible()
  // E2E_HOLD_MS=8000 keeps the finished results on screen before the window closes.
  const hold = Number(process.env.E2E_HOLD_MS ?? 0)
  if (hold > 0) await page.waitForTimeout(hold)
}

export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText)
}

export interface UiRun {
  throughput: number
  errorRatePct: number
  p50: number
  p95: number
  p99: number
  /** Utilization of the named node, percent, from the Run Inspector. */
  utilPct: number
  littlesLaw: string
  conservation: string
}

function num(text: string, re: RegExp, label: string): number {
  const m = text.match(re)
  if (!m) throw new Error(`UI value not found: ${label}`)
  return Number(m[1].replace(/,/g, ''))
}

/** Parse the run results the user sees. Returns plain numbers: ms, percent, req/s. */
export async function readUiRun(page: Page, nodeLabel = 'srv'): Promise<UiRun> {
  const t = await bodyText(page)
  const health = (name: string) => {
    const m = t.match(new RegExp(`${name}\\s*-\\s*([^\\n]+)`))
    return m ? m[1].trim() : ''
  }
  const nodeBlock = t.slice(t.indexOf(`\n${nodeLabel}\n`, t.indexOf('NODES\n')))
  return {
    throughput: num(t, /Success Throughput\s*\n([\d.,]+)\s*rps/, 'Success Throughput'),
    errorRatePct: num(t, /\nError Rate\s*\n([\d.]+)%/, 'Error Rate'),
    p50: num(t, /\np50\s*\n([\d.,]+)\s*ms/, 'p50'),
    p95: num(t, /\np95\s*\n([\d.,]+)\s*ms/, 'p95'),
    p99: num(t, /\np99\s*\n([\d.,]+)\s*ms/, 'p99'),
    utilPct: num(nodeBlock, /UTIL\s*\n([\d.]+)%/, `UTIL of ${nodeLabel}`),
    littlesLaw: health("Little's Law"),
    conservation: health('Conservation')
  }
}
