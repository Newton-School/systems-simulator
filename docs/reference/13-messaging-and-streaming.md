# 13. Messaging and streaming

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 7 `MessagingType`s: `queue`, `pub-sub`, `stream`, `event-bus`, `event-sourcing-store`, `message-broker`,
`task-queue`. Related: change data capture (chapter 09), request batching and Kafka edges (chapter 08),
consumers as compute nodes (chapter 06), and idempotency (chapter 20).

## 1. Why put a broker between services

A **broker** decouples producer and consumer in time, rate and failure: the producer hands off and continues; the consumer processes when ready; a burst waits in the buffer instead of overwhelming the consumer. [D]

- Price: another system to run, **at-least-once** delivery needing idempotent consumers, ordering limits, and added end-to-end latency (chapter 08: an asynchronous edge hides the downstream wait from the caller but not the load).
- **Backpressure** is the alternative to an unbounded buffer: a bounded queue pushes back on producers (reject, block, or shed) so memory does not grow without limit. [D]

## 2. The shapes

| Type                           | Delivery                                                         | Consumers see                                         | Retention                             | Typical use                     |
| ------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------- | ------------------------------- |
| **Queue** (work queue)         | each message to **one** consumer                                 | competing consumers share the work                    | until acknowledged, then deleted      | job processing, task queue      |
| **Pub/sub**                    | each message to **every** subscriber                             | independent copies per subscription                   | usually short                         | notifications, fan-out          |
| **Stream / log** (Kafka-style) | appended to a partitioned **log**; consumers track an **offset** | each consumer group reads the whole log independently | time or size based (days), replayable | event streaming, CDC, analytics |
| **Event bus**                  | routing by event type or rule to interested parties              | subscribers by pattern                                | short                                 | domain events                   |
| **Event-sourcing store**       | the log **is** the system of record; state is a fold over events | any consumer can rebuild state                        | forever                               | auditable state, replay         |
| **Message broker**             | queues and exchanges with routing (AMQP-style)                   | per binding                                           | until consumed                        | enterprise integration          |
| **Task queue**                 | one message to one worker with retries and scheduling            | workers                                               | until done                            | background jobs                 |

[repo] The simulator treats queue, stream, broker and background-worker node types as **asynchronous boundaries** (chapter 08): the producer is acknowledged at append and consumption is an independent flow. [repo]

## 3. Delivery guarantees

| Guarantee         | Meaning                            | How it happens                                                                                  |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| **At most once**  | may lose, never duplicates         | commit the offset / delete the message **before** processing; a crash after loses the message   |
| **At least once** | never loses, may duplicate         | commit / delete **after** processing; a crash after processing but before the commit redelivers |
| **Exactly once**  | each message's effect happens once | at-least-once **plus** idempotent processing or transactions                                    |

[S: Kafka consumer-semantics guides] "Exactly once" is usually **effectively once**: a Kafka producer with idempotence and transactions gives exactly-once between Kafka topics, but effects on an external system need idempotent consumers (an idempotency key, chapter 20). A third-party claim that SQS FIFO is exactly-once is not in AWS's own wording; FIFO gives strict ordering per message group and deduplication within a window. [S]

### 3.1 Visibility timeout and redelivery (SQS style)

A received message is **hidden** for the visibility timeout (default **30 s** in SQS); if the consumer has not deleted it by then, it becomes visible again and another consumer receives it. [P: AWS SQS docs]

- If processing takes longer than the timeout, the message is **redelivered while the first consumer is still working**: a duplicate by design. Standard SQS queues can also deliver a message more than once within the timeout, so consumers must be idempotent. [P]
- If processing time T is exponential with mean 20 s and the timeout is 30 s, the chance a message exceeds the timeout is e^(−30/20) = **22%** (22% of messages will be duplicated). [computed] Set the timeout above a high percentile of processing time (chapter 03).
- **Dead-letter queue (DLQ):** after `maxReceiveCount` failed receives (for example 5) the message is moved to a DLQ so one **poison message** cannot loop forever, loading the consumers 5 times and then stopping. [P/K]

## 4. Consumer groups, partitions and ordering (Kafka-style)

- A topic has **p partitions**. Each partition is an ordered log. **Ordering is guaranteed only within a partition.** A message key hashed to a partition keeps all messages of one key in order. [S/K]
- A **consumer group** shares the work: each partition is read by **exactly one** consumer in the group at a time, so **parallelism is capped by p**: more consumers than partitions leaves the extras idle. Different groups each read everything independently. [S: Conduktor, consumer groups and offsets]
- **Offsets:** a consumer's position in each partition; committing it is what defines at-most-once or at-least-once (section 3). [S]
- **Rebalance:** when consumers join or leave, partitions are reassigned and consumption **pauses** briefly; frequent rebalances look like a throughput dip. [D: no partition is consumed during reassignment]
- **Producer acknowledgement:** acks = 0 (do not wait: fastest, may lose), 1 (leader only: loses if the leader dies before replicating), all (every in-sync replica: safest, slowest). [S: Conduktor, producer acks; with RF = 3 and min.insync.replicas = 2 one broker may fail]
- **Partition count** is chosen for the maximum parallelism and throughput you will need; it is awkward to change later (it breaks key-to-partition mapping). Chapter 12 section 7.

## 5. Queue maths

Every consumer set is a queue (chapter 01). Let producers arrive at rate lambda and consumers drain at rate c x mu.

- **Backlog grows at (lambda − c mu)** when lambda exceeds consumer capacity; it drains at (c mu − lambda) when capacity exceeds arrivals. Producers at 1,200/s against a 1,000/s consumer fleet for 60 s leave **12,000 messages** of lag; if capacity then rises to 1,500/s with arrivals back at 1,000/s, it drains at 500/s in **24 s**. [computed]
- **Lag in time = lag in messages / consume rate.** 12,000 messages at 1,000/s is 12 s behind real time. **Consumer lag** (messages behind the latest offset) is the key health metric. [D]
- **Consumers needed = arrival rate x processing time / target utilisation** (Little's Law): 10,000 msg/s x 50 ms / 0.7 = **714** concurrent workers. [computed]
- **Stability:** a queue is stable only if lambda < c x mu. Below that, delay stays bounded and follows the formulas of chapter 01; above it, an unbounded backlog (or rejected messages if bounded) is the only outcome.
- **Little's Law on the buffer:** messages in queue = arrival rate x time in queue. 1,000/s with a 5 s wait holds 5,000 messages.
- **Storage:** retention storage = rate x size x retention x replication: 10,000 msg/s x 1 KB x 7 days x 3 replicas = **18.1 TB**. [computed]
- **Fan-out amplification:** pub/sub to s subscriptions multiplies delivered load by s: 1,000 msg/s to 5 subscribers is 5,000 deliveries/s. [computed]
- **Batching:** grouping messages cuts per-message overhead but adds up to `linger` of latency (chapter 08 section 8).

**Testable expectations**

- Producer acknowledgement time is independent of consumer speed; the **consumer backlog** is what grows when consumers are slow.
- Lag after t seconds = (lambda − capacity) x t when overloaded; zero when capacity exceeds arrivals.
- Produced = consumed + still in the log (conservation); in a stream, committed + lag = produced.
- With p partitions, a group of more than p consumers has idle members and no extra throughput.
- Messages per key are consumed in order; across partitions no order is promised.
- Redelivery fraction = P(processing time > visibility timeout).

## 6. Event sourcing, replay and snapshots

- The **event log is the source of truth**; current state = fold of events. To recover, **replay** events from the start or from a **snapshot**. [D: definitions]
- Replay time = events replayed x time per event. 10⁶ events at 0.01 ms each = **10 s**; with a snapshot every 10,000 events at most 10,000 are replayed: **0.1 s**. The snapshot interval trades storage and write cost for recovery time. [computed]
- Events are immutable; corrections are new events; schemas evolve through a registry (chapter 09). [D]

## 7. Windowing and stream processing

Streaming analytics groups events into **windows**: tumbling (fixed, non-overlapping), sliding (overlapping), session (gaps). Events in a tumbling window of w seconds at rate r: r x w = 500/s x 10 s = **5,000**. Late events need a watermark or a lateness bound; state grows with window length and keys. [D, chapter 18]

## 8. Change data capture

CDC turns a database's change log into a stream, keeping derived stores in step without dual writes. Ordering is per key or partition; consumers must be idempotent and handle redelivery; a slow consumer lags without affecting the database. [D, chapter 09]

## 9. Failure modes

| Failure                        | Effect                                             | Defence                                                                    |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Consumer slower than producers | backlog and lag grow, then storage or memory limit | scale consumers (to partition count), shed or back-pressure, alert on lag  |
| Poison message                 | endless redelivery, blocks a partition (ordering)  | DLQ after maxReceiveCount                                                  |
| Visibility timeout too short   | duplicates                                         | timeout above processing p99, idempotent consumers                         |
| Broker down                    | producers cannot enqueue                           | producer-side buffering, retries with backoff and idempotence, replication |
| Rebalance storm                | repeated pauses                                    | stable membership, static assignment                                       |
| Hot partition                  | one partition saturates its single consumer        | better key, more partitions (chapter 12)                                   |

## 10. Simulator parameter map

| Setting                                                  | Meaning                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| node type `queue`, `stream`, `message-broker`, `pub-sub` | asynchronous boundary; producer acknowledged at append             |
| `queue.workers`, `processing.distribution` on the queue  | consumer concurrency and processing time (backlog grows when slow) |
| `deliverySemantics`                                      | at-most-once, at-least-once or similar delivery setting            |
| `visibilityTimeoutMs`, `maxReceiveCount`, `dlqNodeId`    | redelivery, poison-message limit, dead-letter target               |
| `partitionCount`, `partitionKeyField`                    | stream partitions and the key that selects one                     |
| `consumerGroup`, `consumerGroupMode`                     | competing consumers within a group, independent groups             |
| `retentionMs`                                            | how long the log is kept                                           |
| `consumerOrdering`                                       | `parallel`, `per-partition`, `per-key`                             |
| batching `batchSize`, `batchWindowMs`, `fixedCostMs`     | micro-batching of consumer work                                    |
| `snapshotEvery`, `replayCostPerEventMs`                  | event-sourcing replay cost                                         |
| `windowMs`                                               | streaming window length                                            |
| dedup `dedupKeyField`, `dedupWindowMs`                   | idempotency at the consumer (chapter 20)                           |

Known probe result recorded in the project: a stream with 200 produced and a slow consumer shows 99 committed and 101 lag, summing to the produced count. A queue's metrics count the producer-side ack and the consumer-side delivery separately, which reads as roughly double the arrivals and half the service time. [repo: `docs/engine-probe-findings.md`, section 3]

## 11. Testable expectations (summary)

- Producer latency excludes consumer processing; consumer backlog grows at (arrival − drain) when drain < arrival.
- Conservation: produced = committed + lag (+ dead-lettered).
- Redelivery share = P(T > visibility timeout); a message is dead-lettered after maxReceiveCount failures.
- Ordering: within a partition or key preserved; across partitions not.
- Consumers beyond the partition count add no throughput.
- Fan-out: delivered load = subscriptions x produced load.
- Replay time = events since last snapshot x per-event cost.

## 12. Open items

- Kafka's own design documentation could not be fetched as text; delivery, consumer-group and acks claims are cited to Conduktor's guides and the SQS developer guide (visibility timeout, read directly). A source for rebalance cost and the SQS FIFO deduplication window are not cited, and no figure here depends on them.
- Decisions `[?]`: whether the stream and queue counters should be labelled "produced" and "delivered" (carried over from the engine probe notes).

## Sources

- [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/AboutVT.html) [P]
- [Amazon SQS queue types](https://docs.aws.amazon.com/ru_ru/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.md) [P]
- [Delivery semantics for Kafka consumers (Conduktor)](https://learn.conduktor.io/kafka/delivery-semantics-for-kafka-consumers) [S]
- [Interpreting Kafka's exactly-once semantics](https://dzone.com/articles/interpreting-kafkas-exactly-once-semantics) [S]
- [KIP-1030: Kafka defaults](https://cwiki.apache.org/confluence/display/KAFKA/KIP-1030:+Change+constraints+and+default+values+for+various+configurations) [P]
