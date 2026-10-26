import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 5290)

/**
 * Use the Playwright-managed Chromium when it is installed. When only an older
 * build is cached (no `npx playwright install` run), set PW_CHROMIUM_PATH or let this
 * fall back to the newest cached headless shell.
 */
function cachedChromium(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  // The headless shell cannot show a window, so --headed / --debug / --ui need the full browser.
  const wantsWindow = process.argv.some((a) => ['--headed', '--debug', '--ui'].includes(a))
  const full = join(
    cache,
    'chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  )
  const shell = join(
    cache,
    'chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell'
  )
  const pick = wantsWindow ? [full, shell] : [shell, full]
  return pick.find((path) => existsSync(path))
}

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Tracing is skipped when driving an existing Chrome (E2E_CDP); it can stall on a shared context.
    trace: process.env.E2E_CDP ? 'off' : 'retain-on-failure',
    // E2E_VIDEO=1 records every test as a video (shown in the HTML report).
    video: process.env.E2E_VIDEO ? { mode: 'on', size: { width: 1280, height: 720 } } : 'off',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: cachedChromium(),
      // E2E_SLOWMO=700 pauses 700 ms between browser actions so you can follow along.
      slowMo: Number(process.env.E2E_SLOWMO ?? 0)
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev:web -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
