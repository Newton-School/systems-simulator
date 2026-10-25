# 24. Architecture and system-design patterns

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The patterns a design is assembled from, what each costs, and what the simulator can show about it. Components are in
chapters 06 to 22; the trade-off tables for choosing between patterns are chapter 25.

## 1. Structure

| Pattern                    | Idea                                                                            | Gains                                                              | Costs                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Layered**                | presentation, application, data in tiers; each calls the one below              | clear separation                                                   | every request crosses every tier; a slow lower tier slows all             |
| **Monolith**               | one deployable                                                                  | simple to run, no network hops between modules, local transactions | scales as one unit; one bad release affects everything                    |
| **Microservices**          | many small independently deployed services                                      | independent scaling and release; fault isolation                   | network hops, partial failure, distributed transactions, operational load |
| **Event-driven**           | components communicate through events on a broker (chapter 13)                  | decoupling in time, easy fan-out, buffering of bursts              | eventual consistency, harder tracing, ordering and duplicate handling     |
| **Sidecar / service mesh** | cross-cutting concerns (TLS, retries, telemetry) in a proxy beside each service | uniform policy                                                     | an extra hop and CPU per call (chapter 07)                                |
| **Cell-based**             | many isolated full copies of the workload, a thin router in front               | failure and bad releases stay inside one cell                      | duplicated capacity, cross-cell operations are hard                       |

Microservice arithmetic [D, computed]: each synchronous hop adds its latency and its failure probability. A request crossing 6 services at 99.9% each is available 0.999^6 = **99.4%**, and its latency is the **sum** along the path. Splitting a monolith therefore costs availability and latency unless the calls are cached, asynchronous or parallel.

**Cell-based architecture:** the workload is partitioned by a key that matches the grain of the service (customer id, resource id); a cell router sends each request to its cell; each cell is independent and shares no state. With 10 cells and 100 requests, a failure in one cell leaves 90% of requests unaffected; it does not necessarily need more hosts (30 hosts can become 3 cells of 10). [P: AWS Well-Architected, cell-based architecture]

## 2. Data and consistency patterns

- **CQRS** (Command Query Responsibility Segregation): separate models for updating and for reading, possibly separate databases. It helps when reads and writes have very different shapes or scale, and Fowler advises caution: it adds complexity, usually brings eventual consistency, and fits a minority of domains; apply it to specific bounded contexts, not the whole system. [S: martinfowler.com]
- **Saga:** a business transaction across services, each with its own database, as a sequence of local transactions. **Choreography:** each service's event triggers the next. **Orchestration:** a central orchestrator tells each service what to do. If a step fails, **compensating transactions** undo the earlier steps; there is no automatic rollback and concurrent sagas can see intermediate data (lack of isolation). [S: microservices.io]
- **Transactional outbox:** to avoid the **dual-write problem** (update the database and publish a message atomically), write the message to an outbox table in the same database transaction; a relay publishes it by polling or tailing the log. Delivery is **at least once**, so consumers must be idempotent (chapter 20). [S: microservices.io]
- **Event sourcing:** the log of events is the record; state is a fold over it; replay cost is events since the last snapshot x cost per event (chapter 13). [D]
- **Read replicas, caching, sharding:** chapters 10 to 12.

## 3. Traffic and scaling patterns

| Pattern                                                    | Mechanism                                                                                                                                        | Arithmetic                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Queue-based load leveling**                              | a queue absorbs bursts so the consumer runs at a steady rate                                                                                     | backlog grows at (arrival - drain); drain time = backlog / (drain - base) (chapter 05)                                                   |
| **Fan-out on write**                                       | when a user posts, copy it into each follower's feed                                                                                             | writes per second = posts/s x followers; a celebrity with 1,000,000 followers posting once per second causes **1,000,000 feed writes/s** |
| **Fan-out on read**                                        | build the feed at read time from the accounts followed                                                                                           | reads per timeline = accounts followed; cost moves from write to read                                                                    |
| **Hybrid**                                                 | fan out on write for ordinary users, on read for celebrities                                                                                     | bounds both costs                                                                                                                        |
| **Bulkhead, circuit breaker, backpressure, load shedding** | chapter 02                                                                                                                                       |                                                                                                                                          |
| **CDN and edge caching**                                   | serve static and cacheable content near the user                                                                                                 | origin share = 1 - hit ratio (chapter 07)                                                                                                |
| **Multi-region active-passive**                            | one region serves, another standby                                                                                                               | failover time = detection + promotion; data loss = replication lag (RPO)                                                                 |
| **Multi-region active-active**                             | both serve                                                                                                                                       | needs conflict handling (chapter 11) and routes users by geography/latency (chapter 21)                                                  |
| **Strangler fig**                                          | build new functionality beside the legacy system and move behaviour over piece by piece through seams, removing the transitional code at the end | risk spread over many small steps [S: martinfowler.com]                                                                                  |

[repo] The simulator expresses fan-out on write directly: an edge's `fanoutFactor` turns one delivered request into that many deliveries, so the downstream genuinely receives N times the load and can saturate.

## 4. Back-of-envelope sizing (the standard interview skeleton)

1. **Requests per second** = daily active users x actions per user per day / 86,400; **peak** = average x a peak factor (2 to 3, or the diurnal ratio of chapter 05).
2. **Read/write ratio** splits it: reads = rate x R / (R + W).
3. **Storage** = records x bytes x retention x replication factor.
4. **Bandwidth** = rate x bytes per response.
5. **Servers** = peak / (per-server rate x target utilization) (chapter 23), plus N+1.

Worked, URL shortener [computed]: 100 million new links per month is 100e6 / 2.592e6 s = **39 writes/s**; at a 10:1 read ratio, **390 reads/s**; five years of links is 6 billion records x 500 bytes = **3 TB** (x3 replication = 9 TB). The reads are served mostly from cache (a Zipf popularity, chapter 05), so the database sees a fraction of the 390/s.

Other standard designs and what they test: **news feed** (fan-out, caching, hot keys), **chat** (long-lived connections, ordering, fan-out; chapters 19 and 13), **rate limiter** (token bucket, distributed counters; chapter 02), **payments** (idempotency, saga, reconciliation; chapter 20), **ticket or seat booking** (contention and reservations; chapter 11), **search** (inverted index, scatter-gather; chapter 12), **video streaming** (transcoding, CDN; chapter 19). [K]

## 5. Anti-patterns

- **Distributed monolith:** services that must be deployed and scaled together, with synchronous chains. [K: anti-pattern definitions]
- **Shared database between services:** couples schemas and removes isolation. [K: anti-pattern definitions]
- **Chatty calls:** N+1 calls in a loop (latency = N x hop). [K: anti-pattern definitions]
- **Unbounded queues and retries without budgets** (chapter 22). [K: anti-pattern definitions]
- **Single point of failure:** a component whose loss disconnects the system. [repo: the output lists `singlePointsOfFailure`]
- **Kitchen-sink design:** every component added regardless of the requirement; it costs money and failure modes. [K, repo: budget and anti-pattern checks]

## 6. Testable expectations (summary)

- End-to-end latency of a synchronous chain is the sum of its hops; availability is the product.
- A cell design confines a fault to its share of traffic (1 / number of cells).
- Fan-out on write multiplies downstream load by the follower count; the write path saturates before the read path.
- A queue in front of a slow consumer protects the producer's latency and builds backlog at (arrival - drain).
- A saga needs compensation: a failed late step leaves earlier steps applied unless compensated.
- The outbox yields at-least-once publication: duplicates are possible, losses are not.
- The sizing arithmetic above reproduces the stated worked numbers.

## 7. Open items

- The pattern descriptions rest on the sources below (AWS cell-based, microservices.io, Fowler); the Azure pattern catalogue and Twitter timeline write-ups are not cited, and the fan-out arithmetic is derived, not measured.
- Decisions `[?]`: whether the simulator should offer saga and outbox as first-class components or leave them as compositions of queue, database and idempotency nodes.

## Sources

- [Saga pattern, microservices.io](https://microservices.io/patterns/data/saga.html) [S]
- [Transactional outbox, microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) [S]
- [CQRS, Martin Fowler](https://martinfowler.com/bliki/CQRS.html) [S]
- [Strangler Fig Application, Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html) [S]
- [What is a cell-based architecture?, AWS Well-Architected](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/what-is-a-cell-based-architecture.html) [P]
