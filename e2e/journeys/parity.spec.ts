/**
 * The same file must give the same answer wherever it runs (docs: catalog/capacityModel.ts).
 * These are the browser-level twin of src/renderer/src/utils/capacityParity.test.ts: they import the
 * document through the real UI and compare what the user sees with the engine run of the same file.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { md1 } from './parity.fixtures'

test('P-01 a raw-queue document shows the same utilization and latency in the UI as in the engine', async ({
  page
}) => {
  // 1 worker, 10 ms, Poisson 80/s: M/D/1 at rho 0.8. Before the fix the UI showed 3.8% and a flat 9.28 ms.
  const topology = md1()
  const out = runEngine(topology)
  expect(out.perNode.srv.utilization).toBeGreaterThan(0.7)

  await openApp(page)
  await importTopology(page, topology)
  await runAndWait(page)
  const ui = await readUiRun(page)
  expect(Math.abs(ui.utilPct / 100 - out.perNode.srv.utilization)).toBeLessThan(0.02)
  expect(Math.abs(ui.p50 - out.summary.latency.p50) / out.summary.latency.p50).toBeLessThan(0.05)
  expect(Math.abs(ui.p99 - out.summary.latency.p99) / out.summary.latency.p99).toBeLessThan(0.05)
})
