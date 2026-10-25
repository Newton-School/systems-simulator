# 20. Integration

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 5 `IntegrationType`s: `webhook-gateway`, `llm-gateway`, `third-party-api-connector`, `payment-gateway`,
`third-party-auth`. Related: retries and breakers (chapter 02), idempotency at consumers (chapter 13), LLM latency
(chapter 18), authentication cost (chapter 15).

## 1. A dependency you do not control

A third-party call is a node whose **latency, availability, rate limit and failure modes belong to someone else**.
You cannot add capacity to it, and its slowness becomes yours. [D]

- **Latency adds:** your response time includes theirs; your p99 is at least their p99 on the path. [D: the dependency is in series with the caller]
- **Availability multiplies:** dependencies in series must all be up. Five dependencies at 99.9% each give 0.999^5 = **99.50%**, not 99.9%. [computed]
- **Rate limits:** providers answer **429 Too Many Requests**, often with a `Retry-After` hint; the client must back off (chapter 02), queue, or shed. [P: RFC 6585 section 4 (429 Too Many Requests; MAY include Retry-After); RFC 9110 for Retry-After]
- **Timeouts and breakers:** set a timeout well below your own caller's deadline and open a circuit breaker on repeated failure (chapter 02) so a slow provider does not hold all your workers (Little: concurrency = rate x their latency). [D]
- **Fallbacks:** a cached answer, a second provider, or degraded behaviour. [D]

## 2. Payments and idempotency

A payment call that **times out** leaves the client not knowing whether the charge happened. Retrying without protection can charge twice. The fix is an **idempotency key**: [P: Stripe API docs]

- The client sends a unique key (a v4 UUID is suggested, up to **255 characters**) in the `Idempotency-Key` header with each `POST`; `GET` and `DELETE` are idempotent by definition and ignore it.
- The server saves the **status code and body** of the first request made with that key, once execution has begun, and returns the saved response to a retry, **including a 500**.
- Keys can be pruned after **24 hours**; a reused key after that makes a new request.
- If a retry's parameters differ from the original's, the server **returns an error** rather than guessing.
- Requests that failed validation or conflicted with a concurrent request are not saved, so they can be retried.

Duplicate-charge arithmetic: with a timeout rate t on charge calls where the server had in fact processed the request, the fraction of charges duplicated by a blind retry is t x (share processed before the timeout). With idempotency keys the duplicate count is **zero** for retries inside the key lifetime. [D]

**Reconciliation:** when an outcome stays unknown, query the provider for the transaction by key before retrying, and run a periodic reconciliation job that matches your records to the provider's. [D]

## 3. Webhooks

A webhook is an **outbound HTTP call from a provider to you** when something happens. Stripe's behaviour is a representative reference: [P: Stripe webhooks documentation]

- **Success is a 2xx** returned quickly, **before** slow work; a 3xx redirect counts as failure; a timeout counts as failure.
- **Retries:** delivery is retried with **exponential backoff for up to three days** in live mode (a few retries over hours in test mode). Delivery is therefore **at least once**.
- **Duplicates happen:** keep the ids of processed events and skip repeats. **Order is not guaranteed:** events like `invoice.created` and `invoice.paid` can arrive in either order, so fetch current state instead of trusting arrival order.
- **Process asynchronously:** put the event on a queue and return 200; a burst (for example subscription renewals at the start of a month) can overwhelm a synchronous handler.
- **Verify the sender:** an HMAC-SHA256 signature over `timestamp.body` with a secret, and a timestamp **tolerance of 5 minutes** against replay.

Endpoint arithmetic: if a provider sends bursts of B events in a second and your handler takes s seconds with c workers, the backlog drains in B s / c seconds; without a queue the excess fails and is retried later, adding to the next burst. [computed]

## 4. Authentication with a third party (OAuth/OIDC)

- A sign-in redirects the user to the provider and back (several round trips and a token exchange), an interactive cost paid once per session. [D]
- Access tokens are short-lived; a **refresh token** gets a new one. Validating a token locally (signature) is cheap, introspecting it is a network call per request unless cached (chapter 15). [S: RFC 7519 for local validation; OAuth 2.0 refresh tokens]
- A provider outage blocks new sign-ins; existing valid tokens keep working until they expire. [D]

## 5. LLM gateways

A gateway in front of one or more model providers: routing, caching, rate-limit handling, fallback to another provider, token accounting. Latency and cost are per token (chapter 18); a provider's tokens-per-minute limit is a rate limit as above. [D]

## 6. Failure modes

- **Slow provider** (not down): workers pile up waiting; without a timeout and breaker the whole service stalls (the bimodal-latency case of chapter 22).
- **Rate limited:** 429s; retries make it worse (retry amplification).
- **Duplicate side effects:** retries or redelivered webhooks without idempotency.
- **Out-of-order events** applied as if in order.
- **Provider schema or version change** breaks parsing.
- **Signature or clock-skew failures** reject genuine webhooks.

## 7. Simulator parameter map

| Setting                                                                                                       | Meaning                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `externalLatencyMs`                                                                                           | provider latency added to each call on `third-party-api-connector`, `payment-gateway`, `third-party-auth`, `webhook-gateway` and push services |
| `dedupKeyField`, `dedupWindowMs`, `storeLookupMs`                                                             | idempotency manager: which request field is the key, how long a key is remembered, the lookup cost                                             |
| `commitOutcomeJournal`, `reconcileUnknownOutcomes`, `externalReconciliationMode`, `reconciliationProbeResult` | unknown-outcome handling after a timeout                                                                                                       |
| `resilience.retry`, circuit breaker, timeout                                                                  | client-side protection (chapter 02)                                                                                                            |

[repo] The idempotency manager records the decision for each request (first, duplicate in window, expired window).

## 8. Testable expectations (summary)

- A third-party node adds its configured latency to each call; end-to-end latency is the sum along the path.
- Availability of a series of dependencies is the product of their availabilities.
- A duplicate key inside the window is recognised and not executed again; a key after the window is a new request.
- A retry without a key on a timeout can execute the effect twice; with a key it cannot.
- A webhook endpoint that responds slower than the provider's timeout is retried; duplicates are possible, so the effect count must be guarded by an event id.
- A rate-limited provider returns 429 above its limit; naive retries raise the offered rate.

## 9. Open items

- Read directly: RFC 6585 (429) and RFC 9110 (`Retry-After`). Not cited: the IETF idempotency-key header draft, RFC 6749 in full, and a payment provider's timeout guidance; the duplicate-charge arithmetic stands on its own definitions.
- Decided and implemented: a provider's rate limit is a setting on third-party nodes (`rateLimitRps`; past it calls fail as a retryable `provider_rate_limited`, the 429). Webhook redelivery over days is not built in.

## Sources

- [RFC 6585: additional HTTP status codes](https://www.rfc-editor.org/rfc/rfc6585.txt) [P]
- [RFC 9110: HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.txt) [P]
- [RFC 7519: JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519.txt) [P]

- [Idempotent requests, Stripe API](https://docs.stripe.com/api/idempotent_requests) [P]
- [Receive Stripe events in your webhook endpoint](https://docs.stripe.com/webhooks) [P]
