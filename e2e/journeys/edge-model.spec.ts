/**
 * Connector mode versus network mode (the environment's "Edge model").
 *
 * In the default environment connections are plain wires: a run ignores their latency, error rate and loss.
 * That is deliberate, but it used to be silent. These flows check that the importer says so, that it does not
 * show warnings that only make sense in network mode, and that the way out it names (Settings > Environments >
 * Edge model > Network) really does make the UI show what the engine computes for the same file.
 */
import { expect, test, type Page } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr } from '../support/oracles'
import { instanceServer } from '../support/topology'

/** Settings > Environments > Edge model > Network, the way out the import notice names. */
async function useNetworkEdges(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Environments', exact: true }).click()
  await page.getByRole('button', { name: 'Network', exact: true }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()
}

/** 50 ms link and 20% errors in front of a 10 ms server, 50 req/s for 20 s. */
function linkWithPhysics() {
  const t = instanceServer(
    {
      name: 'edge-model',
      rps: 50,
      pattern: 'constant',
      durationMs: 20_000,
      warmupMs: 0,
      seed: 'edge-model'
    },
    { service: { type: 'constant', value: 10 } }
  )
  t.edges[0] = {
    ...t.edges[0],
    latency: { distribution: { type: 'constant', value: 50 }, pathType: 'same-dc' },
    errorRate: 0.2,
    maxConcurrentRequests: 50_000
  }
  return t
}

test('M-01 the importer says which connection settings connector mode will ignore', async ({
  page
}) => {
  await openApp(page)
  const dialog = await importTopology(page, linkWithPhysics())
  expect(dialog).toMatch(/Connector mode ignores connection settings/)
  expect(dialog).toMatch(/latency 50 ms, 20% errors/)
  expect(dialog).toMatch(/Settings > Environments > Edge model to Network/)
})

test('M-02 connector mode does not show network-only warnings, nor a false "queue missing" for a sized node', async ({
  page
}) => {
  await openApp(page)
  const dialog = await importTopology(page, linkWithPhysics())
  expect(dialog).not.toMatch(/Max concurrent requests above 10,000/)
  expect(dialog).not.toMatch(/Queue settings are missing/)
})

test('M-03 what the notice promises is what happens: the run ignores the link physics', async ({
  page
}) => {
  await openApp(page)
  await importTopology(page, linkWithPhysics())
  await runAndWait(page)
  const ui = await readUiRun(page)
  // Server alone: 10 ms and no errors, as if the 50 ms link and the 20% errors were not there.
  expect(ui.p50).toBeLessThan(15)
  expect(ui.errorRatePct).toBe(0)
})

test('M-04 the way out works: switching Edge model to Network makes the UI match the engine', async ({
  page
}) => {
  const topology = linkWithPhysics()
  const out = runEngine(topology)
  expect(out.summary.latency.p50).toBeGreaterThan(55)
  expect(out.summary.errorRate).toBeGreaterThan(0.15)

  await openApp(page)
  await importTopology(page, topology)

  await useNetworkEdges(page)

  await runAndWait(page)
  const ui = await readUiRun(page)
  expect(relErr(ui.p50, out.summary.latency.p50)).toBeLessThan(0.05)
  expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(2)
})

test('M-05 network mode keeps its own warnings and shows no connector notice', async ({ page }) => {
  await openApp(page)
  await useNetworkEdges(page)
  const dialog = await importTopology(page, linkWithPhysics())
  expect(dialog).not.toMatch(/Connector mode ignores/)
  expect(dialog).toMatch(/Max concurrent requests above 10,000/)
})
