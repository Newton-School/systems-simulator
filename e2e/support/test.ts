/**
 * `test` with one extra capability: when E2E_CDP is set (for example http://localhost:9222) the
 * browser tests drive that already-running Chrome instead of launching their own, so you can
 * watch the page change in a window you already have open.
 */
import { chromium, expect, test as base } from '@playwright/test'

export { expect }

export const test = base.extend({
  page: async ({ page }, provide) => {
    const endpoint = process.env.E2E_CDP
    if (!endpoint) {
      await provide(page)
      return
    }
    const browser = await chromium.connectOverCDP(endpoint, {
      slowMo: Number(process.env.E2E_SLOWMO ?? 0)
    })
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const remote = await context.newPage()
    await remote.setViewportSize({ width: 1440, height: 900 })
    await provide(remote)
    await remote.close()
    await browser.close() // disconnects only; the Chrome you started keeps running
  }
})
