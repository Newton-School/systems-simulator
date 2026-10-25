# Feature Flags — Spec

Status: proposed (not implemented). Goal: one typed, discoverable way to ship unfinished or risky
behaviour dark, turn it on per build, per user or per URL, and delete the switch once it is
settled — replacing the several ad-hoc gates the renderer uses today.

## 1. Why

The app has no flag mechanism, but it already has five informal ones, each with its own plumbing:

| Existing gate                                                        | Where                                                                 | Kind                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| `import.meta.env.DEV`                                                | `QuestionPanel.tsx`, `LlmGradingTab.tsx`, `performanceDiagnostics.ts` | build-time, dev only   |
| `simpleShell` display setting ("Simple layout (beta)")               | Settings > Display; see `docs/ui-progressive-disclosure.md`           | persisted user setting |
| `?studio=question` / `?surface=question-studio` / `/question-studio` | `appSurface.ts`                                                       | URL deep-link gate     |
| `?debug=console` remembered in storage                               | `analytics/analytics.ts`                                              | URL + storage override |
| `VITE_*` analytics sinks                                             | `analytics/analytics.ts`                                              | build-time env         |

Problems: no registry of what gates exist, no owner or removal date, no common way to test both
states, and `.github/pull_request_template.md` already asks whether a change touches "feature
flags" with nothing to point at.

**Not in scope:** per-question control (what is editable, graded or revealed). That is authored
content stored in the question package; see [question-policy-spec.md](question-policy-spec.md).
Also out of scope: the engine's `isEnabledFor(node)` trait predicates and the simulated
`feature-flag-service` node. Those model the user's design, not the app's release state. Flags
must never be read inside `src/engine/**` (see 6.1).

## 2. Goals and non-goals

Goals

- A single typed registry; `isEnabled('name')` is the only read path.
- Resolution from build defaults, env, persisted override, and URL, in a fixed order.
- Every flag declares an owner, a kind, and (for release flags) an expiry.
- Trivial to test both states in unit tests.
- Zero runtime dependencies; no network calls.

Non-goals

- Remote or server-side flag service, percentage rollouts, or per-student targeting. Revisit only
  if a hosted backend ever exists (see 9).
- Using flags to change grading or simulation results (6.1).

## 3. Design

### 3.1 Registry

`src/renderer/src/config/featureFlags.ts` holds the only list of flags:

```ts
export type FlagKind = 'release' | 'experiment' | 'ops' | 'permission'

export interface FlagDef {
  /** Human description shown in the dev panel. */
  description: string
  kind: FlagKind
  /** Default when nothing overrides it. Production default is what users get. */
  default: boolean
  owner: string
  /** ISO date; required for 'release' and 'experiment'. A test fails once it passes. */
  expires?: string
  /** If true, URL and stored overrides are ignored in production builds. */
  lockedInProd?: boolean
}

export const FLAGS = {
  simpleShell: {
    description: 'Simple layout shell',
    kind: 'release',
    default: false,
    owner: 'ui',
    expires: '2027-01-31'
  },
  questionStudio: {
    description: 'Question Studio surface',
    kind: 'release',
    default: true,
    owner: 'authoring',
    expires: '2027-01-31'
  },
  llmGrading: {
    description: 'LLM justification grading',
    kind: 'ops',
    default: false,
    owner: 'grading',
    lockedInProd: true
  },
  perfDiagnostics: {
    description: 'PerformanceObserver diagnostics',
    kind: 'ops',
    default: false,
    owner: 'ui'
  }
} as const satisfies Record<string, FlagDef>

export type FlagName = keyof typeof FLAGS
```

The four entries are the migration candidates from section 1, not new behaviour. Names are
camelCase; `FlagName` is derived so a typo is a compile error.

### 3.2 Resolution order (first hit wins)

1. **Locked:** if `lockedInProd` and `import.meta.env.PROD`, return `default`.
2. **URL:** `?flag.<name>=on|off` (session only, not stored). `?flags=a,-b` is shorthand.
3. **Stored override:** `localStorage['ns.flags']` JSON, set from the dev panel (3.4).
4. **Build env:** `VITE_FLAG_<SCREAMING_SNAKE_NAME>=true|false`.
5. **Registry default.**

Parsing is strict: anything other than `on|off|true|false|1|0` is ignored. Storage access is
wrapped in try/catch and falls through, as `analytics.ts` already does for blocked storage.

### 3.3 API

```ts
isEnabled(name: FlagName): boolean            // pure read, memoised per page load
useFlag(name: FlagName): boolean              // React hook; re-renders on override change
withFlags(overrides: Partial<Record<FlagName, boolean>>, fn: () => T): T   // test helper
```

Overrides live in a tiny subscribable module store (not `useStore`) so flags can be read outside
React. `useFlag` uses `useSyncExternalStore`.

The two existing patterns are kept, not replaced: `simpleShell` stays a user-facing setting
(it is a preference, not a rollout switch); it becomes the `simpleShell` flag's **default source**
only if we decide to retire the toggle. Decision recorded in 9.

### 3.4 Dev panel

A "Feature flags" section in Settings, visible only when `import.meta.env.DEV` or
`?flags=panel`. It lists every flag with description, kind, owner, expiry, effective value, and
where the value came from (url / stored / env / default), with a toggle and a Reset. This is the
only writer of `ns.flags`.

### 3.5 Analytics

When a flag is resolved to a non-default value, include `flags: { name: value }` on the existing
session-start analytics event so behaviour reports can be tied to flag state. No per-read events.

### 3.6 Ease of change

Adding a flag is one entry in `FLAGS`; it is immediately typed, listed in the dev panel, overridable
by URL/env/storage, and covered by the registry and expiry tests. Removing one is deleting that
entry, which turns every leftover `isEnabled('name')` into a compile error. Per-mode and
per-question control is not done with flags; use the
[visibility matrix](feature-visibility-matrix-spec.md) and
[question policy](question-policy-spec.md), which are data-driven and editable from the UI.

## 4. Flag kinds and lifecycle

| Kind         | Purpose                           | Lifespan      | Rules                                                          |
| ------------ | --------------------------------- | ------------- | -------------------------------------------------------------- |
| `release`    | Ship dark, enable when ready      | Days to weeks | Must have `expires`; delete flag and dead branch when fully on |
| `experiment` | Compare two behaviours            | Weeks         | Must have `expires`; record decision in PR                     |
| `ops`        | Kill switch / dev-only tooling    | Long-lived    | No expiry; document who may flip                               |
| `permission` | Gate by audience (e.g. authoring) | Long-lived    | Not a security boundary; client-side only                      |

Lifecycle: add flag (default `false`) → merge code behind it → enable in staging/env → flip default
to `true` → delete flag and the old path. A flag is "done" only when its entry is removed.

## 5. Conventions

- Branch at the **highest sensible point** (one gate per feature, e.g. which component mounts), not
  scattered `if`s through leaf code.
- Keep both branches working until removal; the off path is the shipping path until the default flips.
- No flag combinations that must be coordinated: if flag B requires A, make B check A in the
  registry (`requires?: FlagName[]`, evaluated in `isEnabled`), not in call sites.
- Never persist flag state inside saved designs, blueprints or question files.

## 6. Constraints

### 6.1 Determinism

Flags must not alter simulation or grading output. `src/engine/**` and the grading/check code
must not import `featureFlags`; enforce with a lint rule (`no-restricted-imports`) and an
architecture test. A flag that changes what students see (defaults, visibility of checks or
results, test-run limits, locked or hidden surfaces) is a student/author-impact change: follow the
PR template's impact checklist and keep that flip in its own commit.

### 6.2 Security

Flags are client-side and user-overridable except `lockedInProd`. Do not gate anything that must
be secret or enforced; LLM grading keeps its server-side availability check in addition to the flag.

### 6.3 Bundle

Registry is a small constant object; no flag SDK. Code behind an off `import.meta.env`-resolved
build flag may be tree-shaken only for build-time resolution; runtime overrides keep both paths in
the bundle, which is acceptable at current size.

## 7. Testing

- `featureFlags.test.ts`: resolution order, strict parsing, blocked storage, `lockedInProd`,
  `requires`.
- **Expiry test:** fails when any `release`/`experiment` flag is past `expires`, forcing cleanup.
- **Registry test:** every flag has owner and description; env var names are unique.
- Component tests use `withFlags({ simpleShell: true }, ...)`; any flagged surface must have a test
  per state.
- Architecture test for 6.1.

## 8. Migration plan

1. Add `featureFlags.ts`, tests, `env.d.ts` typings for `VITE_FLAG_*`. No behaviour change.
2. Move `import.meta.env.DEV` gates (LLM grading, perf diagnostics) to `ops` flags with defaults
   equal to today's behaviour (`llmGrading` default derived from DEV; locked in prod).
3. Add the dev panel.
4. Map `?studio=question` onto `questionStudio` / keep `appSurface.ts` deep links working as-is.
5. Decide `simpleShell` (9) and add flag state to analytics.
6. Add flags section to the PR template and a short contributor note.

Each step is independently shippable and leaves production behaviour unchanged.

## 9. Open questions

1. **`simpleShell`:** keep as a user setting, or promote to a release flag and retire the toggle
   once the default flips? Recommendation: keep the setting; use a flag only for the _default_.
2. **Remote flags:** is a hosted backend (or Newton-hosted config) coming? If so, add a resolution
   step between 3 and 4 behind the same `isEnabled` API; no call-site changes.
3. **Audience gating:** do authors vs students need different defaults? If yes, add a `role`
   input to resolution rather than separate flags.
4. **Expiry enforcement:** hard-fail CI, or warn for one release first?

## 10. Acceptance criteria

- One registry; no remaining direct `import.meta.env.DEV` feature gates in the renderer.
- `isEnabled` is typed by `FlagName`; unknown names do not compile.
- Production behaviour is identical to today with no overrides set.
- Dev panel shows effective value and source for every flag.
- Expiry, registry and determinism tests pass in CI.
