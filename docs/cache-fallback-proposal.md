# Cache failure and fallback: findings and proposal

Status: proposal. No engine behavior has changed. Evidence below comes from reading
`src/engine/traits/cache.ts`, `src/engine/engine.ts` and the `basic-cache-stack` sample, and from a
throwaway engine probe (deleted; the numbers are reproducible with the setup described).

## 1. What actually produces the 89.5%

The "Cache-Aside Read Path" sample (`basic-cache-stack.json`) does **not** use the cache trait's hit
roll. It encodes cache-aside with two _conditional edges_ out of the API Server:

- `api -> redis-cache` when `request.type === "READ_HIT"`
- `api -> primary-db` when `request.type === "READ_MISS"`

The request type is chosen when the workload generates the request, so "hit or miss" is fixed
**before anything checks the cache's health**. With the cache Down, every `READ_HIT` request is
sent to the dead cache and fails (7,756 of 7,756 received), while `READ_MISS` requests reach the
database as usual. 89.5% is the workload's hit share, and there is no fallback edge. The
cache's own `cacheHitRate` is never consulted in this sample (its config is empty).

So the claim "the engine decides hit/miss before the health check" is right in effect, but the
mechanism is the request type and the conditional edge, not a roll inside the cache.

## 2. A second, worse finding: a Down inline cache still serves hits

Designs that use the real cache trait (`in-memory-cache`, `cdn`, `reverse-proxy` with
`cacheHitRate` or `derived-lru`) behave differently. A hit is decided in `beforeArrival` and
completed immediately (`action: 'handled'`). The node's failure roll (`shouldFailAtNode`, from
`nodeErrorRate`) only runs when _service completes_, so hits never reach it. Probe: source -> cache
-> db, 100 rps for 2 s, hit rate 0.9, 200 requests:

| Cache state                        | Succeeded | Failed         | Cache hits | DB arrivals |
| ---------------------------------- | --------- | -------------- | ---------- | ----------- |
| healthy                            | 200       | 0              | 178        | 22          |
| `nodeErrorRate = 1` (Down)         | **191**   | 9              | 191        | **0**       |
| `nodeErrorRate = 0`, hit rate 0    | 0         | 200            | 0          | 0           |
| scheduled fault `reject`           | 177       | 23             | 177        | 0           |
| scheduled fault `blackhole`/`hang` | 177       | 15 (timed out) | 177        | 0           |
| scheduled fault `degraded`         | 200       | 0              | 179        | 21          |

Two problems:

1. **A "down" cache keeps answering its hits.** That is wrong on its own, whatever we decide about
   fallback. Only the misses fail.
2. **Misses fail instead of falling back.** The database receives nothing, so the load shift a
   cache outage causes (the lesson) is invisible.

Fix 1 is a correctness bug (a Down or faulted node must not serve). Fix 2 is the new feature below.

## 3. Proposal: a fallback policy

### (a) Where it lives: on the caller's edge, with a narrow node-level exception

Agreed with putting it on the caller or the API -> cache edge, for these reasons:

- **The caller owns the decision.** In cache-aside the application catches the cache error and goes
  to the database. The cache cannot do that: in the conditional-edge design it has no outgoing edge
  to the database at all, and in the inline design it would have to pretend to be a pass-through
  proxy.
- **The primitive is general.** "If this call fails, try that edge instead" also covers circuit
  breaker fallbacks, replica reads, and a CDN origin. It reuses the failure classification the
  engine already has for retries (`isRetryableFailure`).

Proposed edge setting (`EdgeDefinition`, default = today's behavior):

```
onFailure: {
  policy: 'fail-closed' | 'fail-open'   // default 'fail-closed'
  fallbackTargetId?: string             // required for fail-open; the node to try instead
  callTimeoutMs?: number                // when to give up on a silent target (see b)
}
```

One exception where a **node-level** setting is right: an _inline_ cache that forwards its own
misses (a CDN or reverse proxy) can be **bypassed** when down, because it already has the
downstream edge. That would be `cache.failurePolicy: 'bypass'` and is optional, a second phase.

Where I would disagree with a pure edge-only design: the editor must make this discoverable, or
nobody will set it. The inspector for an edge into a cache should say "If this call fails" and
offer the sibling database as the suggested fallback.

### (b) How hang and black-hole add the client timeout before fallback

Detection time depends on the failure mode:

| Mode        | What the caller sees   | When fallback can start                     | Cost                                                                 |
| ----------- | ---------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `reject`    | instant `node_failed`  | immediately (edge latency only)             | near zero added latency, then the DB call                            |
| `blackhole` | nothing comes back     | after `callTimeoutMs`                       | p99 rises by about `callTimeoutMs` + DB                              |
| `hang`      | accepted, then frozen  | after `callTimeoutMs`                       | same, and the cache holds its slot until the timeout                 |
| `degraded`  | slow or partial errors | on error, or if slower than `callTimeoutMs` | partial fallback; the late reply is abandoned and its work is wasted |

The important design point: the fallback must wait for **`callTimeoutMs`, not the request
deadline**. The request deadline defaults to 30 s (`defaultTimeout`), so waiting for it would leave
no time to fall back. `callTimeoutMs` is the per-call client timeout, and without it a fail-open
policy is a no-op for blackhole and hang. Mechanically:

- On dispatch over an edge with `fail-open`, schedule a call-timeout event; cancel it on completion.
- On a retryable failure or a fired call-timeout, abandon the attempt, clear its per-attempt state,
  and re-arrive at `fallbackTargetId` with the same request and deadline. This mirrors
  `maybeScheduleRetryAttempt` (same release of leases and connections), but targets a different node
  and has no backoff.
- One fallback per edge per request, so it cannot loop.
- It runs _before_ the retry budget is spent. A retry then re-runs the whole call including the
  fallback.
- New counters: `fallbackAttempts`, `fallbackSuccesses`, `fallbackTimeouts`, so the shift is visible
  in the results and the run summary.

### (c) Impact on the question bank

Scanned `ns-simulator-docs/examples/question-bank` (topology and `question.json` files) and the
engine samples:

| Measure                                                         | Count                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Question-bank items                                             | 14                                                                                    |
| Items with a cache or CDN node                                  | 5 (`cache-placement`, `cargo-cult-cdn`, `news-feed`, `ride-hailing`, `url-shortener`) |
| Of those, using the cache trait (`cacheHitRate` / `cacheModel`) | 4                                                                                     |
| Items that set `nodeErrorRate` on any node                      | 0                                                                                     |
| Items with a scheduled fault targeting a cache                  | 0                                                                                     |
| Engine samples with a cache                                     | 1 (`basic-cache-stack`), no failure set                                               |

No bank item reaches a cache-failure path today, so neither the opt-in policy nor the "Down must not
serve" fix changes any bank result. Caveats: this covers the files in the repo only (not
host-supplied questions), and the check is by node type and id, so a cache modelled under another
name would be missed. Classroom mode compiles designs without failures or faults, so it is
unaffected.

## 4. Tests to add with the change

- **Conservation:** cache down + fail-open: DB arrivals equal the hit-share of source arrivals, and
  total errors are about 0 unless the DB saturates.
- **Down must not serve:** `nodeErrorRate = 1` and each scheduled fault mode: zero cache hits served
  while the node is down.
- **Mode matrix:** reject, blackhole, hang, degraded: expected added latency (about
  `callTimeoutMs` for blackhole and hang) and fallback counters.
- **Default unchanged:** the existing samples and question-bank runs produce identical output with
  the policy at `fail-closed`.

## 5. Suggested order, and decisions needed

1. **Bug fix first (done, see `docs/engine-probe-findings.md` section 3b):** a Down or faulted trait cache must not serve hits. This changes
   results for any design that sets a failure on a trait cache (none in the bank).
2. **Opt-in edge fallback** (`fail-closed` default), engine only, with the tests above.
3. **Editor support:** the "If this call fails" control on edges into a cache, a Down/Degraded node
   badge is already in place, and a run-summary line such as "Cache down: 3,100 requests fell back
   to the database; DB load rose from 10% to 100% of traffic".
4. **Later, a product decision:** whether `fail-open` should become the default for cache-aside
   designs. It changes every existing result and needs sign-off.

Decisions for the owner: whether step 1 ships as a bug fix without an opt-in; the default
`callTimeoutMs` (suggest 100 ms); and whether the optional node-level `bypass` for CDN and reverse
proxy is wanted.
