# 25. Architecture decisions

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established knowledge or derived here,
not yet source-checked, **[?]** needs an owner decision. See [README](README.md).

How a design choice is recorded and argued, and the trade-off tables behind the choices a system-design question
asks for. Each table row points to the chapter holding the numbers.

## 1. Recording a decision (ADR)

Michael Nygard's architecture decision record has five parts: [S: Cognitect blog, Documenting Architecture Decisions]

| Part             | Content                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Title**        | a short noun phrase ("ADR 9: LDAP for multitenant integration")                                                                      |
| **Status**       | proposed while stakeholders review, accepted once agreed, later deprecated or superseded with a pointer to the replacement           |
| **Context**      | the technological, political, social and project-local forces at play, stated as facts without judgment, showing where they conflict |
| **Decision**     | the response, in full active sentences beginning "We will"                                                                           |
| **Consequences** | every result, positive, negative and neutral, since all of them shape what comes next                                                |

Practice: one or two pages, numbered sequentially and never reused, never deleted when reversed (marked superseded instead), kept in the repository beside the code. [S]

A good ADR in a system-design answer names the **requirement** that forces the choice (a number: latency, rate, availability), the **options** considered, the **deciding trade-off** and the **cost accepted**. [K]

## 2. How to decide: from requirements to numbers

1. State the non-functional targets as numbers: p99 latency, availability, throughput, durability, cost per hour (chapter 29: NFR targets).
2. Estimate load (chapter 24 section 4) and the **dominant bottleneck** (compute, storage, network, resilience).
3. For each candidate, compute the figure the target is about, using the formulas of chapters 01 to 23.
4. Choose the cheapest option that meets every target with headroom (chapter 23), and write down what would change the decision (a different read/write ratio, a stricter SLO).
5. Check the choice by simulating it against the same targets (chapter 29).

## 3. Trade-off tables

**SQL or NoSQL (chapters 09, 11, 12)**

| Question                                        | Prefer relational                          | Prefer NoSQL                     |
| ----------------------------------------------- | ------------------------------------------ | -------------------------------- |
| Need joins, constraints, multi-row transactions | yes                                        | usually no                       |
| Access pattern                                  | varied, ad hoc queries                     | known key-based access           |
| Write scale                                     | one primary (vertical, then shard by hand) | horizontal partitioning built in |
| Consistency                                     | strong by default                          | tunable, often eventual          |
| Schema                                          | enforced, migrations                       | flexible, application-enforced   |

**Synchronous or asynchronous (chapters 02, 13)**

|                             | Synchronous              | Asynchronous (queue/stream)               |
| --------------------------- | ------------------------ | ----------------------------------------- |
| Caller waits for the result | yes                      | no, gets an acknowledgement               |
| Burst handling              | overload propagates      | buffered, backlog grows                   |
| Failure                     | caller sees it           | retried, dead-lettered, needs idempotency |
| Latency                     | sum of path              | producer fast, end-to-end longer          |
| Use when                    | the answer is needed now | work can complete later, bursts, fan-out  |

**Push or pull (chapters 13, 19)**: push gives low latency and needs held connections or fan-out writes; pull is simple and stateless but wastes requests polling (a 5 s poll by 1,000,000 clients is 200,000 requests/s whether or not anything changed). [K, computed]

**Where to cache (chapter 10)**

| Layer                    | Hit saves                  | Limit                                         |
| ------------------------ | -------------------------- | --------------------------------------------- |
| Client / browser         | the whole round trip       | stale until expiry; per-user                  |
| CDN / edge               | origin load and distance   | cacheable content only (chapter 07)           |
| Application (in-process) | a network hop to the cache | per-instance copies, cold on restart          |
| Shared cache (Redis)     | database load              | a network hop, an extra dependency, stampedes |
| Database buffer          | disk reads                 | fixed by memory                               |

**Consistency level (chapter 11)**: strong or linearizable costs read latency (wait for the replica) and availability under partition; eventual is fast and available but returns stale reads with probability 1 - e^(-w x lag); read-your-writes sits between and is often enough for user-facing data. [K]

**Monolith or microservices (chapter 24)**: start monolithic unless independent scaling, team autonomy or fault isolation is a stated requirement; each split adds a hop, a failure mode and an operational cost. [K]

**Queue or stream (chapter 13)**: a queue deletes on acknowledgement and shares work among consumers; a stream keeps a replayable log and lets several groups read independently. [K]

**Vertical or horizontal scaling (chapter 06)**: vertical is simple up to the largest instance and the USL peak; horizontal needs stateless services or partitioned state and a balancer. [K]

**Build, buy or managed service (chapter 23)**: managed removes operations at a per-request price; self-run is cheaper at scale and costs engineers. [K]

## 4. Requirements that force a choice

| Requirement                        | Forces                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- |
| p99 below a few ms for reads       | cache or in-memory store in front of the database                      |
| Write throughput above one machine | partitioning (shard key choice, chapter 12) or an LSM store            |
| Availability above 99.99%          | redundancy across zones, no single point of failure, tested failover   |
| Never lose an acknowledged write   | synchronous or quorum replication, write-ahead log, idempotent retries |
| Global users                       | multi-region, CDN, latency-based routing, conflict handling            |
| Spiky traffic                      | queue-based load leveling, autoscaling with headroom, load shedding    |
| Tight budget                       | right-sizing, reserved capacity, spot for tolerant work (chapter 23)   |

## 5. Failure modes of decision-making

- Choosing by familiarity instead of by the numbers; **resume-driven** design.
- Optimising a component that is not the bottleneck (find it first: chapter 27's latency decomposition and failure locus).
- Ignoring the consequences column: the cost accepted is never written down, then forgotten.
- Over-design: every component added regardless of the requirement (a budget and a node-count constraint exist to prevent it).

## 6. Testable expectations (summary)

- A decision record contains a requirement, the options, the deciding figure and the accepted cost.
- Each table row's claim can be reproduced with the cited chapter's formula.
- For a stated requirement, the chosen design meets the numbers in a simulated run and a plainly worse alternative does not.

## 7. Open items

- Fetch and cite: adr.github.io templates (MADR), the AWS Well-Architected trade-off guidance, the CAP/PACELC papers' consequences for choices.
- Decisions `[?]`: whether grading should accept a written justification (the question package has a `justify` field; see chapter 29) as evidence of a decision.

## Sources

- [Documenting Architecture Decisions, Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) [S]
