# End-to-end flows

Playwright flows for the simulator. Expected values come from `docs/reference/` (the real-world
chapters) through `support/oracles.ts`, never from engine output. A mismatch is a finding to triage.

```bash
npm run test:e2e           # everything
npm run test:e2e:ch01      # queueing and performance math (docs/reference/01)
npm run test:e2e:ch02      # reliability patterns (docs/reference/02)
npm run typecheck:e2e
```

Each flow checks up to three things: THEORY (engine against the closed form), UI (what the user sees
against the same closed form or the engine), PARITY (UI against engine for the identical document).

| File                                | Covers                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oracles.spec.ts`                   | The formulas themselves, against the numbers hand-computed in the chapters                                                                         |
| `journeys/ch01-queueing.spec.ts`    | Q-01 to Q-09: Erlang C, determinism, hockey stick, overload cap, M/M/2/4 blocking and Little's Law, utilization law, variability, QuickCart sizing |
| `journeys/ch02-reliability.spec.ts` | R-01 to R-07: failure shape, retry amplification, circuit breaker, token bucket, bulkhead, load shedding, health-aware routing                     |

Chromium: uses the Playwright-managed browser if installed, else the cached headless shell
(`PW_CHROMIUM_PATH` overrides). Port: `E2E_PORT` (default 5290).

## Findings from building these flows

| #   | Finding                                                                                                                                                                                                                   | Status                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Same JSON, different answer: the canvas replaced an authored raw `queue` with a default instance on import (1 worker became 64), so the UI disagreed with the engine, the CLI and the grader (80.9% vs 3.8% utilization). | **Fixed.** One owner, `src/engine/catalog/capacityModel.ts`: an authored `resources` runs as authored, an authored `queue` runs as written, and neither gets the engine default. The importer, the serializer and the loader no longer inject an instance. The Resources panel says "Sized by a queue". Locked by `src/renderer/src/utils/capacityParity.test.ts` and flow `P-01`. |
| 1b  | A node that authors neither a queue nor resources is sized by the engine default (1 worker, 1 ms) when run directly but by the palette template when imported.                                                            | Tracked: `it.fails` in `capacityParity.test.ts`. Needs the engine and palette to share one default profile.                                                                                                                                                                                                                                                                        |
| 2   | Circuit breaker config is inert on node types that do not apply it.                                                                                                                                                       | Validator now warns at import (`R-03d`). Whether it should gate everywhere is still a product decision.                                                                                                                                                                                                                                                                            |
| 3   | Retries do not cover timeouts.                                                                                                                                                                                            | Parked (`R-02c`). Documented in `docs/reference/02-reliability-patterns.md` section 9.                                                                                                                                                                                                                                                                                             |
| 4   | Health detection is instant; chapter says interval x failures.                                                                                                                                                            | Tracked as an expected failure (`R-07c`, `test.fail`).                                                                                                                                                                                                                                                                                                                             |
| 5   | The default UI mode ignores edge latency, bandwidth and error settings ("plain wires").                                                                                                                                   | Open. Edge-latency flows need the mode that honours them.                                                                                                                                                                                                                                                                                                                          |
