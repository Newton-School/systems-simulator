/**
 * Renderer glue for the Newton Game Playground wire contract (see
 * `engine/analysis/newtonGamePlayground.ts`). This is the protocol `newton-web`'s
 * generic game host speaks - distinct from our own `ns-simulator:*` protocol in
 * `questionHostMessaging.ts`. Selected at runtime via `?host=newton` on the
 * iframe src so both protocols can coexist.
 *
 * Origin pinning is shared with `questionHostMessaging` (one trusted host per
 * frame) so the two adapters agree on who the host is.
 */
import {
  NEWTON_READY_EVENT,
  parseNewtonSeed,
  type NewtonGameSeed,
  type NewtonSaveBlob
} from '../../../engine/analysis/newtonGamePlayground'
import { getTrustedHostOrigin, resolveConfiguredHostOrigins } from './questionHostMessaging'

/** Whether the iframe was embedded by the Newton Game Playground host. */
export function isNewtonHostMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return new URLSearchParams(window.location.search).get('host') === 'newton'
}

/** Safe parse of a host seed message; returns null on anything malformed. */
export function parseNewtonSeedMessage(data: unknown): NewtonGameSeed | null {
  try {
    return parseNewtonSeed(data)
  } catch {
    return null
  }
}

/**
 * Target for the contentless `ready-event` bootstrap: the pinned host if known,
 * a single configured origin, else `'*'` so the initial handshake can complete.
 */
function readyTargetOrigin(): string {
  const trusted = getTrustedHostOrigin()
  if (trusted) {
    return trusted
  }
  const configured = resolveConfiguredHostOrigins()
  if (configured.length === 1) {
    return configured[0]
  }
  return '*'
}

export function postNewtonReady(): void {
  if (typeof window === 'undefined' || window.parent === window) {
    return
  }
  window.parent.postMessage(NEWTON_READY_EVENT, readyTargetOrigin())
}

// The last state posted, so a host `'save'` request can re-emit it verbatim.
let lastSaveBlob: NewtonSaveBlob | null = null

/**
 * Posts the save blob to the host as a JSON **string** (the host `JSON.parse`s
 * whatever it receives and persists it as `game_json`). Sensitive - targets the
 * pinned host origin; drops if none is established yet.
 */
export function postNewtonSave(blob: NewtonSaveBlob): void {
  lastSaveBlob = blob
  if (typeof window === 'undefined' || window.parent === window) {
    return
  }
  const target = getTrustedHostOrigin()
  if (!target) {
    console.warn('[ns-simulator] Dropped Newton save - no trusted host origin established.')
    return
  }
  window.parent.postMessage(JSON.stringify(blob), target)
}

/** Re-emits the most recent save blob in response to a host `'save'` command. */
export function repostLastNewtonSave(): boolean {
  if (!lastSaveBlob) {
    return false
  }
  postNewtonSave(lastSaveBlob)
  return true
}

/** Test-only: clears the cached save blob between cases. */
export function resetNewtonSaveCache(): void {
  lastSaveBlob = null
}
