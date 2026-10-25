# 28. Glossary

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).
One line per term, with the chapter that explains it. Terms that are simulator settings are in `code font`.

| Term                                            | Meaning                                                                                     | Ch         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------- |
| **Abstraction (architect, guided, classroom)**  | how much of the simulator a learner works with                                              | 29         |
| **ACID**                                        | atomicity, consistency, isolation, durability of database transactions                      | 09         |
| **Active-active / active-passive**              | all regions serve / one region serves and one waits                                         | 24         |
| **ADR**                                         | architecture decision record: title, status, context, decision, consequences                | 25         |
| **Amdahl's law**                                | speed-up limit 1 / ((1 - p) + p / n) from the serial fraction                               | 06         |
| **Anomaly score (WAF)**                         | running total of rule matches; a request is blocked above a threshold                       | 15         |
| **Asynchronous edge**                           | the caller continues without waiting for the response                                       | 08, 13     |
| **At-least-once / at-most-once / exactly-once** | delivery guarantees: may duplicate / may lose / effect once                                 | 13         |
| **Availability**                                | fraction of time or requests served; series multiply                                        | 02, 20     |
| **Backpressure**                                | a bounded buffer pushing back on producers                                                  | 02, 13     |
| **Bandwidth-delay product**                     | bytes in flight to fill a link: bandwidth x round-trip time                                 | 08         |
| **Blackhole**                                   | failure where packets vanish and the client waits its timeout                               | 22         |
| **Blast radius**                                | share of users or capacity one fault can affect                                             | 22, 24     |
| **Bloom filter**                                | compact set test with false positives, used to skip files in an LSM store                   | 09         |
| **Bulkhead**                                    | per-compartment concurrency cap so one noisy workload cannot take every worker              | 02         |
| **Burn rate**                                   | error-budget consumption speed relative to the SLO                                          | 16         |
| **Cache stampede**                              | many concurrent misses for one key hitting the backend                                      | 10         |
| **Canary**                                      | releasing to a small share of traffic first                                                 | 17         |
| **CAP / PACELC**                                | consistency, availability, partition tolerance trade-off, and its latency extension         | 11         |
| **Cardinality (metrics)**                       | number of distinct label combinations                                                       | 16         |
| **CDC**                                         | change data capture: a stream of row changes                                                | 13         |
| **Cell-based architecture**                     | isolated full copies of a workload behind a router                                          | 24         |
| **Che approximation**                           | closed-form LRU hit ratio under independent requests                                        | 10         |
| **Circuit breaker**                             | stops calling a failing dependency, then probes                                             | 02         |
| **Coefficient of variation (CV)**               | standard deviation / mean; 0 deterministic, 1 exponential                                   | 01, 03     |
| **Cold start**                                  | extra latency on first use (serverless, cold cache, restarted node)                         | 06, 22     |
| **Compensating transaction**                    | an action that undoes a completed saga step                                                 | 24         |
| **Connection pool**                             | a bounded set of reusable connections                                                       | 08, 09     |
| **Consistent hashing**                          | keys and nodes on a ring so adding a node moves about 1/(N+1) of keys                       | 07, 12     |
| **Consumer group**                              | consumers sharing a stream's partitions; each group reads everything                        | 13         |
| **CQRS**                                        | separate models for commands and queries                                                    | 24         |
| **Dead-letter queue (DLQ)**                     | where messages go after too many failed deliveries                                          | 13         |
| **Degraded**                                    | serving slowly or partly rather than down                                                   | 22         |
| **Discrete-event simulation (DES)**             | advancing a clock from event to event                                                       | 04         |
| **Diurnal**                                     | daily cycle of load                                                                         | 05         |
| **DNS TTL**                                     | how long an answer may be cached                                                            | 21         |
| **Envelope (evaluation)**                       | frozen, checksummed record of one graded submission                                         | 29         |
| **Erlang B / C**                                | blocking probability / probability of waiting in M/M/c                                      | 01         |
| **Error budget**                                | 1 - SLO: the failures allowed over the window                                               | 16         |
| **Event sourcing**                              | the event log is the system of record                                                       | 13         |
| **Eventual consistency**                        | replicas converge if writes stop                                                            | 11         |
| **Failover**                                    | switching to a standby                                                                      | 11, 21, 22 |
| **Fan-out (on write / on read)**                | copying a post to followers' feeds when written / assembling at read                        | 24         |
| **Fault domain**                                | a region, zone or subnet that fails together                                                | 22         |
| **Fencing token**                               | increasing number that lets a store reject a stale lock holder                              | 11         |
| **Golden signals**                              | latency, traffic, errors, saturation                                                        | 16         |
| **Goodput**                                     | successful work per second                                                                  | 27         |
| **Gray failure**                                | failure the health checker does not see but applications do                                 | 22         |
| **Hash ring**                                   | the structure behind consistent hashing                                                     | 12         |
| **Head / tail sampling**                        | decide at the start of a trace / after it completes                                         | 16         |
| **Headroom**                                    | unused capacity, 1 - utilization                                                            | 23         |
| **Health check**                                | probe that removes a failing target; detection = interval x failures                        | 02, 07     |
| **Hedged request**                              | duplicate request sent after a delay to cut tail latency                                    | 12         |
| **Hot key / hot shard**                         | one key or shard carrying disproportionate load                                             | 12         |
| **HPA**                                         | Kubernetes horizontal pod autoscaler: ceil(current x metric / target)                       | 14         |
| **Idempotency key**                             | client token that makes a retried request a no-op                                           | 20         |
| **Idempotent**                                  | repeating has the same effect as doing it once                                              | 13, 20     |
| **In flight**                                   | requests accepted but not finished                                                          | 27         |
| **Invariant**                                   | a condition that must hold over a run                                                       | 26, 29     |
| **IOPS**                                        | I/O operations per second a device can do                                                   | 09         |
| **Kingman's formula**                           | queue wait approximation for G/G/1                                                          | 01         |
| **Lag (replication / consumer)**                | how far behind a follower or consumer is                                                    | 11, 13     |
| **Latency percentile (p50, p95, p99)**          | value below which that fraction of requests fall                                            | 01, 16     |
| **Leader / follower**                           | the replica that accepts writes / those that copy it                                        | 11         |
| **Little's law**                                | L = lambda x W                                                                              | 01         |
| **Load balancer (L4 / L7)**                     | spreads requests across targets by connection / by request content                          | 07         |
| **Load shedding**                               | rejecting work early to protect the rest                                                    | 02         |
| **LRU / LFU / TTL**                             | evict least recently used / least frequently used / by age                                  | 10         |
| **LSM-tree**                                    | write-optimised store: memtable, sorted files, compaction                                   | 09         |
| **M/M/1, M/M/c, M/M/c/K, M/G/1, M/D/1**         | queue notation: arrivals/service/servers/capacity                                           | 01         |
| **Mathis bound**                                | TCP throughput limit from loss and round-trip time                                          | 08         |
| **Metastable failure**                          | overload sustained by a feedback loop after the trigger ends                                | 22         |
| **Microservices**                               | many small independently deployed services                                                  | 24         |
| **Monotonic reads**                             | a session never sees older data than it already saw                                         | 11         |
| **MTBF / MTTR**                                 | mean time between failures / to repair (declared in `failureModes`, not read by the engine) | 26         |
| **N+1 / N+2**                                   | capacity to survive one / two failures                                                      | 23         |
| **NFR**                                         | non-functional requirement: a latency, availability or throughput target                    | 29         |
| **Observability**                               | asking new questions of a system from its outputs                                           | 16         |
| **Open / closed workload**                      | arrivals independent of / dependent on completions                                          | 05         |
| **Outbox (transactional)**                      | message written in the same transaction as the data, relayed later                          | 24         |
| **P-K formula**                                 | Pollaczek-Khinchine mean wait for M/G/1                                                     | 01         |
| **Paranoia level**                              | how many WAF rules are active                                                               | 15         |
| **Partition (network)**                         | a split in which nodes cannot talk                                                          | 11         |
| **Partition (stream)**                          | an ordered log segment; consumers get whole partitions                                      | 13         |
| **Poisson process**                             | memoryless arrivals at a constant rate                                                      | 03, 05     |
| **Power of two choices**                        | pick two at random, take the less loaded                                                    | 07         |
| **Priority / WFQ**                              | queue disciplines: by priority / weighted fair queueing (`queue.discipline`)                | 26         |
| **Quorum**                                      | majority agreement; R + W > N overlaps                                                      | 11         |
| **Raft**                                        | consensus protocol with leader election and a replicated log                                | 11         |
| **Rate limiter (token bucket / leaky bucket)**  | caps request rate                                                                           | 02         |
| **RBAC / IAM**                                  | role-based access control / identity and access management                                  | 15         |
| **Read-your-writes**                            | a session sees its own writes                                                               | 11         |
| **Reject**                                      | instant refusal (a fast failure)                                                            | 22         |
| **Replay (trace / log)**                        | re-running recorded arrivals / re-reading a log                                             | 05, 13     |
| **Retry budget**                                | cap on retries as a fraction of traffic                                                     | 02, 22     |
| **Rho (utilization)**                           | arrival rate x service time / servers                                                       | 01         |
| **RPO / RTO**                                   | data loss tolerated / time to recover                                                       | 24         |
| **Saga**                                        | a sequence of local transactions with compensation                                          | 24         |
| **Saturation**                                  | how full the most constrained resource is                                                   | 16, 27     |
| **Scatter-gather**                              | query all shards and merge; latency is the slowest, mean mu x H_n                           | 12         |
| **Seed**                                        | random-number start value making a run reproducible                                         | 04, 26     |
| **Service mesh / sidecar**                      | proxies beside services doing TLS, retries, telemetry                                       | 07, 24     |
| **SFU / MCU / mesh**                            | video topologies: forward / mix / peer to peer                                              | 19         |
| **Shard / shard key**                           | a partition of data / the field that picks it                                               | 12         |
| **SLI / SLO / SLA**                             | measured indicator / internal target / contractual promise                                  | 16         |
| **Snapshot (event store)**                      | saved state that bounds replay                                                              | 13         |
| **SPOF**                                        | single point of failure                                                                     | 24, 27     |
| **Spot instance**                               | discounted capacity the provider can reclaim                                                | 23         |
| **Stale read**                                  | a read that misses a newer write                                                            | 11         |
| **Strangler fig**                               | gradual replacement of a legacy system                                                      | 24         |
| **Structural rule**                             | a graph-shape requirement checked before simulation                                         | 29         |
| **Thundering herd**                             | many clients acting at once (reconnect, cache expiry)                                       | 10, 19, 22 |
| **Timeout**                                     | the longest a caller waits                                                                  | 02         |
| **Tumbling / sliding / session window**         | fixed non-overlapping / overlapping / gap-delimited windows                                 | 18         |
| **USL**                                         | universal scalability law: contention and coherency limit scaling                           | 06         |
| **Utilization**                                 | share of capacity in use                                                                    | 01         |
| **Visibility timeout**                          | how long a received message stays hidden before redelivery                                  | 13         |
| **Warmup**                                      | initial period excluded from metrics                                                        | 04         |
| **Watermark**                                   | stream progress marker for event time                                                       | 18         |
| **Write amplification**                         | bytes written to disk per byte of application write                                         | 09         |
| **Zipf distribution**                           | popularity where item r has weight r^(-s)                                                   | 05, 10, 12 |
