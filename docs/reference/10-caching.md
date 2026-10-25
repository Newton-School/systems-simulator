# 10. Caching

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

A cache keeps a copy of data closer or cheaper to reach than its source, so most requests never touch the source.
The simulator's cache node models a **hit ratio**, a **hit latency**, a **miss path to a backing store**, and the failure
and warm-up behaviour. Storage is chapter 09; CDNs and proxies chapter 07; consistency of cached data chapter 11.

## 1. What a cache buys

**Effective latency = h x t_cache + (1 − h) x (t_cache + t_backing)**, where h is the hit ratio. [S: Wikipedia states the hit ratio; the average-access formula is the standard model]

- t_cache 1 ms, t_backing 8 ms: h = 0.9 gives **1.8 ms**; h = 0.99 gives 1.08 ms; h = 0 gives 9 ms (the cache is pure overhead). [computed]
- **Backing-store load = (1 − h) x request rate.** At h = 0.95 the store sees 5% of the traffic; 0.99 sees 1%. Going from 0.99 to 0.95 multiplies store load by 5 (chapter 07 section 6).
- **The mean hides the tail.** At h = 0.9 the slowest 10% of requests are all misses, so p90 and above are the **backing store's latency**, not the cache's. A cache improves the median far more than the p99. [D: the tail of a mixture is the slower component]

**Testable expectations**

- Backing-store arrivals = (1 − h) x cache arrivals (within sampling error).
- Mean latency follows the formula; p50 equals the hit latency when h > 0.5.
- h = 0 (or a flushed cache) makes every request pay both hops.

## 2. What decides the hit ratio

Three things: **cache size relative to the working set**, **how skewed popularity is**, and **how fresh data must be** (TTL and invalidation). [D: the three terms of the hit-ratio and staleness formulas below]

### 2.1 Popularity: Zipf (chapter 05 section 4)

If request probability of the rank-r key is proportional to r^(−s), a cache that **perfectly holds the C hottest keys** (the best possible static policy, LFU-like) hits with probability H(C, s) / H(N, s). For N = 1,000 keys:

| s                 | C = 10 | C = 100 | C = 300 |
| ----------------- | ------ | ------- | ------- |
| 1.0 (classic web) | 39.1%  | 69.3%   | 83.9%   |
| 0.8               | 23.1%  | 52.6%   | 72.5%   |

(Perfect-LFU ceilings.) To reach a 90% ceiling at s = 1.0 you need **473 of the 1,000 keys**: skew helps, but a long tail still has to fit. [computed]

### 2.2 Eviction policies [S: Wikipedia cache replacement policies]

| Policy           | Evicts                         | Strength                         | Weakness                                                         |
| ---------------- | ------------------------------ | -------------------------------- | ---------------------------------------------------------------- |
| LRU              | least recently used            | adapts to shifting popularity    | not scan-resistant: one pass over cold data flushes useful items |
| LFU              | least often used               | keeps persistently popular items | holds on to formerly popular items too long                      |
| FIFO             | oldest inserted                | cheap                            | ignores use                                                      |
| Random           | random item                    | no bookkeeping                   | average                                                          |
| Bélády (optimal) | used farthest in the future    | the best possible                | needs the future; only a benchmark                               |
| ARC / 2Q         | balances recency and frequency | self-tuning, scan-resistant      | more state                                                       |
| TTL-based        | expired first                  | bounded staleness                | must still pick among unexpired                                  |

Redis offers approximated LRU and LFU (`allkeys-lru`, `allkeys-lfu`) and TTL-based `volatile-ttl`; the eviction policy is set by `maxmemory-policy`. [S: Redis docs, policy list only]

### 2.3 How well does LRU do? The Che approximation [S: Che et al. 2002; arXiv 1202.3974]

For independent requests with rate q_i for item i, an LRU cache of capacity C behaves as if each item stays a "characteristic time" t_C after its last request, where t_C solves
**C = sum over i of (1 − e^(−q_i t_C))**, and the hit probability of item i is **1 − e^(−q_i t_C)**; the overall hit ratio is the request-weighted sum. It is accurate for large catalogues of items that each have a small share of popularity, and exact in the limit under Zipf popularity. [S]

- N = 1,000 keys, s = 1.0: LRU hit ratio **20.9%** at C = 10, **57.7%** at C = 100, **77.1%** at C = 300, against the ideal 39.1%, 69.3% and 83.9%. [computed]
- s = 0.8: 8.2%, 37.8% and 62.3%, against 23.1%, 52.6% and 72.5%. [computed]
- Reading: **a real LRU cache holding 10% of the keys gets about 58% of the requests, not the 69% of a perfect one**: the 11-point gap is the price of not knowing the future. Lower skew (smaller s) hurts more.

**Testable expectations**

- Derived-LRU cache hit ratio for Zipf traffic matches the Che prediction within a few percentage points and always sits below the ideal top-C share.
- Hit ratio rises with cache size, with diminishing returns; and rises with skew s.
- A uniform workload (s = 0) gives hit ratio about C / N.

## 3. Cache patterns

| Pattern                        | Read                                                           | Write                                                                                 | Notes                                                                                |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Cache-aside** (lazy loading) | app checks cache, on miss loads from store and fills the cache | app writes the store, then deletes or updates the cache                               | most common; app owns the logic; races between a fill and an update leave stale data |
| **Read-through**               | cache loads from store itself on miss                          | as above                                                                              | simpler callers; cache must know the store                                           |
| **Write-through**              | n/a                                                            | writes go to cache and store together [S]                                             | cache always fresh; every write pays both                                            |
| **Write-back** (write-behind)  | n/a                                                            | writes go to the cache first and reach the store later, when the entry is evicted [S] | fast writes; **data loss if the cache fails before flushing**                        |
| **Write-around**               | n/a                                                            | writes go straight to the store, not the cache [S]                                    | avoids filling the cache with write-once data                                        |

Keeping a cache consistent with its store is hard; the safe, simple defaults are short TTLs and invalidate-on-write. [S: Redis and memcached practice; the Facebook paper's delete-on-write with leases]

## 4. Time to live and staleness

- A TTL bounds how stale an entry can be: maximum staleness = TTL. A shorter TTL means more misses: if a key is requested at rate r and cached for TTL seconds, it causes at most **one miss per TTL** to refresh; with r x TTL requests per refresh the **hit ratio of that key is 1 − 1 / (r x TTL + 1)**. A key hit 10 times per TTL has hit ratio 91%. [K, derived]
- Synchronised TTLs (everything cached at once, same expiry) expire together; add **jitter** to TTLs to spread refreshes. [D: same reasoning as retry jitter, chapter 02]
- `Cache-Control` for shared caches: `s-maxage`; browsers `max-age`; `no-store` disables caching. [S, chapter 07]

## 5. Cache stampede (thundering herd)

When a popular entry expires or the cache is flushed, **many requests miss together and all recompute**, overloading the store, which slows recomputation, which causes more misses: congestion collapse and a hit ratio that can fall to zero. [S: Wikipedia cache stampede]

- Example: a page that takes 3 s to render and is requested 10 times per second causes about 3 x 10 = **30 simultaneous recomputations** at expiry. [S]
- **Mitigations [S]:**
  - **Locking / request collapsing:** the first miss recomputes; others wait for it or are served a stale value. Cost: an extra write per lock, lock-holder failure handling, TTL tuning.
  - **External recomputation:** a separate refresher updates entries before they expire.
  - **Probabilistic early expiration (XFetch):** each request recomputes early with probability rising towards expiry: recompute when now − delta x beta x ln(U) >= expiry [P: Vattani et al., VLDB 2015, Algorithm 1: `if !value or Time() − ∆β log(rand()) ≥ expiry`], with U uniform on (0, 1), delta the measured recompute time and beta about 1. The early-recompute offset is exponential with mean delta x beta, so refreshes spread out.
  - **Leases (Facebook memcache):** the cache hands one client a short-lived token to fill a missing key and tells others to wait; a delete invalidates the token. Reported to cut database query rate from about 17,000 to 1,300 per second in one case (figure from secondary summaries). [S]
- **Request collapsing arithmetic:** with collapsing, a miss storm of k concurrent requests for one key produces **1** backing-store request instead of k.

**Testable expectations**

- After a flush, backing-store load spikes toward the full request rate and decays as the cache refills; with request collapsing the spike is at most one request per key.
- Without collapsing, concurrent misses for one key each reach the store.

## 6. When the cache fails

- A **cache that is down serves nothing**: every request becomes a miss, so store load jumps from (1 − h) x rate to the **full rate**. At h = 0.95 that is a **20x** load increase, usually enough to take the store down too. This is why caches must not be the only capacity (plan the store for the cold-cache case or protect it). [D]
- A down cache must **not** keep answering its remembered hits (a bug this project fixed): after the failure time the hit counter must stop.
- **Fallback policy:** on a cache failure a client may fail, fall back to the store (risking overload), or serve stale data. The default is a decision. **[?]**
- Warm-up after restart or flush: hit ratio starts at 0 and recovers as popular keys reload; recovery time depends on request rate and key popularity. [D]

## 7. Simulator parameter map

| Setting                        | Meaning                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `cacheModel`                   | `declared-rate` (a fixed hit rate you set) or `derived-lru` (hit ratio emerges from an LRU over the workload's keys)                 |
| `cacheHitRate`                 | the declared hit probability (declared-rate model)                                                                                   |
| `cacheHitLatencyMs`            | time to answer a hit                                                                                                                 |
| `cacheRamMb`, `valueSizeBytes` | cache capacity in entries = RAM / value size (derived-LRU model)                                                                     |
| `requestCollapsing`            | collapse concurrent misses for the same key into one backing request                                                                 |
| `ttlSeconds`, `cacheEngine`    | expiry and engine (redis, memcached)                                                                                                 |
| cache flush fault              | empties a cache at a time; declared-rate caches miss every arrival for the re-warm duration; derived-LRU caches re-warm from traffic |
| node failure                   | a failed cache answers no hits                                                                                                       |

## 8. Testable expectations (summary)

- Backing arrivals = (1 − h) x requests; latency follows the formula.
- Derived-LRU hit ratio under Zipf tracks the Che approximation and stays under the ideal top-C share.
- Cache size C and skew s each increase the hit ratio monotonically.
- Flush: hit ratio goes to 0 then recovers; request collapsing caps the stampede at one backing request per key.
- Cache down: backing load jumps to the full request rate; no hits are counted after the failure.

## 9. Open items

- Che et al. is cited through its arXiv summary (1202.3974); the Facebook memcache paper's lease result (peak database query rate 17K/s without leases, 1.3K/s with, for one set of keys over a week) is read in the paper itself; Redis approximates LRU by sampling (`maxmemory-samples`, 5 by default) and its documentation reports little difference from true LRU under power-law access.
- Decisions `[?]`: default fallback behaviour for a down cache; whether write-back with data loss on failure should be modelled.

## Sources

- [Optimal probabilistic cache stampede prevention, VLDB 2015](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf) [P]
- [Scaling Memcache at Facebook, NSDI 2013](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) [P]
- [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/) [P]

- [Cache stampede, Wikipedia](https://en.wikipedia.org/wiki/Cache_stampede) [S]
- [Cache (computing), Wikipedia](<https://en.wikipedia.org/wiki/Cache_(computing)>) [S]
- [Cache replacement policies, Wikipedia](https://en.wikipedia.org/wiki/Cache_replacement_policies) [S]
- [A versatile and accurate approximation for LRU cache performance (arXiv 1202.3974)](https://arxiv.org/pdf/1202.3974) [S]
- [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/index.html.md) [P, list only]
- [Scaling Memcache at Facebook (NSDI 2013)](https://www.usenix.org/node/172909) [P, abstract; leases via secondary summaries]
