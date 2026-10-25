# 12. Sharding and partitioning

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

Splitting data or traffic across machines so no single one carries it all: `sharding`, `hashing`, `shard-node`,
`partition-node`, and the key-routing in chapter 07. Replication (copies of the same data) is chapter 11;
this chapter is about dividing **different** data.

## 1. Why shard, and the cost

A single node has a ceiling on storage, writes per second and memory. **Sharding** divides the keyspace so each node holds and serves a part. [D: definition]

- **Capacity scales with the number of shards only if load is even.** Total capacity = shards x per-shard capacity **at best**; in practice the limit is the **hottest shard**.
- **Costs:** queries that span shards (fan-out, section 5), no cross-shard transactions without extra protocol, rebalancing work, operational complexity. Do not shard until one node cannot cope. [D: each cost is a property of the design, not a measured figure]

## 2. How keys map to shards

| Scheme                 | Shard of a key                             | Good at                                              | Bad at                                                                             |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Hash**               | hash(key) mod n, or a hash range           | even spread of many keys                             | range queries scan every shard; changing n moves almost every key with plain `mod` |
| **Consistent hash**    | next node clockwise on a ring (chapter 07) | few keys move on resize; virtual nodes even the load | still uneven under skew                                                            |
| **Range**              | contiguous key ranges                      | range scans stay on one shard                        | **hot spots** on monotonic keys (timestamps, auto-increment ids)                   |
| **Directory / lookup** | a table maps key (or key range) to shard   | flexible placement, rebalancing                      | the directory is a dependency and must itself scale                                |
| **Geo / tenant**       | by region or customer                      | data locality, isolation                             | uneven tenants                                                                     |

[D] Resize cost: adding a shard moves about **1 / (N + 1)** of the keys with consistent hashing (9 to 10 shards: 10%), but about **N / (N + 1)** with `hash mod n` (90%). [chapter 07, computed]

## 3. Choosing a shard key

A good key has **high cardinality** (many distinct values), **even access** (no value much hotter than others), and matches **how queries filter** so most queries touch one shard. [S: AWS DynamoDB partition-key guidance, K]

- Bad: a date as the key when all today's writes share one value (one hot shard); a boolean; a country in a global app dominated by one country.
- Fix hot keys by adding a **suffix** (key#0..key#k) and writing to a random one, then reading all k and merging: trades read cost for write spread. [S: AWS DynamoDB partition-key guidance; the write-sharding pattern]
- A **composite key** (tenant + id) isolates tenants and spreads load within one. [D]

## 4. Hot keys and skew

Real access is skewed (Zipf, chapter 05). **Hashing the key spreads many keys evenly but cannot split one key.**

- With Zipf s = 1.0 over 1,000 keys, the hottest key is **13.4%** of traffic. Over 20 shards, an even share is 5%, so the shard holding that key carries **at least 2.7x** its fair share however well the rest is balanced. [computed, chapter 05]
- **Per-key limits are real:** DynamoDB throttles one partition above about **3,000 reads and 1,000 writes per second**; adaptive capacity absorbs imbalance as long as total traffic stays within the table's capacity and the partition maximum, and can isolate a hot item, but one item cannot exceed one partition's ceiling. A key needing 25,000 writes/s needs the load spread over at least **25** key values. [P: AWS DynamoDB burst and adaptive capacity page]
- **Mitigations:** key suffixing, caching the hot items (chapter 10), replicating hot shards for reads, splitting the hot range.

**Testable expectations**

- Hash routing over many uniformly distributed keys gives shard shares of 1/n within the sampling error plus the ring's own spread: a consistent-hash ring with V virtual nodes per shard gives each shard an arc with relative standard deviation about 1/sqrt(V) (Karger et al.; Dynamo), so V = 64 gives a standard deviation of about 12.5% of the even share (individual shards can be 25% off) and V = 256 about 6%. Under Zipf, the busiest shard's share is at least the hottest key's share.
- The busiest shard saturates first; total throughput is bounded by the hottest shard's capacity divided by its share of traffic: with a hottest shard of capacity C carrying share f, system throughput <= C / f.
  Worked: C = 1,000 req/s per shard and f = 0.134 gives at most **7,463 req/s** in total, however many shards exist. [computed]

## 5. Scatter-gather queries and the tail

A query that must consult all n shards finishes when the **slowest** responds, so its latency is the **maximum** of n shard latencies.

- If shard latencies are independent exponentials with mean mu, **E[max] = mu x H_n** where H_n is the nth harmonic number. n = 1: 1.0 x mu; n = 10: **2.93 x**; n = 100: **5.19 x**; n = 1,000: **7.49 x**. For large n, H_n is about ln n + 0.577. [S: order statistics of exponentials; computed]
- The **p99 of the maximum** grows too: for exponentials p99 of max = mu x (−ln(1 − 0.99^(1/n))): n = 1: 4.6 x; n = 10: 6.9 x; n = 100: **9.2 x**; n = 1,000: 11.5 x. [computed]
- And a rare slow shard becomes the common case: if each shard is slow with probability q, a query across n shards is slow with probability 1 − (1 − q)^n; q = 1%, n = 100: **63%** (chapter 01 section 6, _The Tail at Scale_). [P: Dean and Barroso, The Tail at Scale]
- **More shards do not make a scatter-gather query faster**; past a point they make its tail worse. Hedged requests, partial results and targeting only the shards that hold the data reduce it. [P: Dean and Barroso, The Tail at Scale, hedged and tied requests]
- The simulator models the consequence by adding a penalty drawn as the maximum of `shardCount` exponential samples of mean `perShardLatencyMs`. [repo]

**Testable expectations**

- Mean added latency of a scatter-gather over n shards = mu x H_n; it grows about logarithmically in n.
- Doubling shards does not halve query time; it adds about mu x ln 2 to the mean.

## 6. Rebalancing and resharding

- Adding capacity means moving data: bytes moved = data x fraction moved; time = bytes / transfer rate while still serving traffic. 200 GB, 10% moved at 100 MB/s: **200 s** of background copy. [computed]
- **Many small partitions** (more logical partitions than machines, e.g. 1,024 virtual shards over 10 machines) make rebalancing move whole partitions without re-hashing keys. [D: the key-to-partition map is unchanged; only the partition-to-machine map moves]
- **Hot shard splitting:** a shard whose traffic exceeds a threshold relative to the average (the simulator's `hotShardThresholdRatio`, with a minimum sample count) is split. [repo]
- During a rebalance, routing must stay consistent (a key never served from two places) and a moved key's cache entries are cold. [D]

## 7. Partitions in messaging (preview of chapter 13)

A Kafka-style topic is divided into **partitions**; ordering holds **within** a partition, a key always maps to the same partition, and parallelism of consumers is capped by the partition count. Choosing the partition count is choosing the maximum parallelism: more partitions raise throughput and rebalance cost. [K, chapter 13]

## 8. Cross-shard operations

- A **transaction touching several shards** needs a protocol (two-phase commit, sagas): extra round trips, blocking on failure, a coordinator. Cost grows with shards touched. [D]
- **Joins** across shards require shipping data or co-locating related rows (same shard key). Choose the key so related data lives together. [D]
- **Secondary indexes** are either local (query every shard) or global (a separate sharded index, updated asynchronously). [D: definitions]

## 9. Simulator parameter map

| Setting                                                                                    | Meaning                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `routingKeyField`                                                                          | request field whose value picks the shard         |
| `missingRoutingKeyPolicy`                                                                  | what to do when a request has no key              |
| `autoShardRebalance`, `hotShardThresholdRatio`, `hotShardMinSamples`, `shardSplitKeyField` | automatic hot-shard splitting                     |
| `shardCount`, `perShardLatencyMs`                                                          | scatter-gather fan-out and per-shard mean latency |
| workload `keyspace {field, size, skew}`                                                    | the keys requests carry and their Zipf skew       |
| routing strategies `ip-hash`, `sticky`, consistent hash                                    | how a node maps a key to a target (chapter 07)    |

## 10. Testable expectations (summary)

- Even keys: shard shares 1/n within 3 standard errors. Zipf keys: hottest shard >= hottest key's share.
- System throughput under skew <= capacity of the hottest shard / its traffic share.
- Scatter-gather mean = mu x H_n, p99 as above.
- Adding a shard moves about 1/(N + 1) of the keys (consistent hashing) or N/(N + 1) (`mod`).
- Splitting a hot shard lowers its share.

## 11. Open items

- DynamoDB limits are quoted from AWS's burst and adaptive capacity page and change over time; Vitess and Citus resharding mechanics are not cited and none of this chapter's numbers depend on them.
- Decisions `[?]`: how a split shard's keys are divided in the simulator and whether splitting is instantaneous.

## Sources

- [DynamoDB burst and adaptive capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html) [P]

- [DynamoDB partition-key design (uniform load)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-uniform-load.html) [P]
- [Consistent hashing, Wikipedia](https://en.wikipedia.org/wiki/Consistent_hashing) [S]
- [Probable Approximate Coordination (expected maximum of exponentials)](https://arxiv.org/pdf/2311.05368) [S]
- [The Tail at Scale, CACM 2013](https://research.google/pubs/pub40801/) [P, abstract]
