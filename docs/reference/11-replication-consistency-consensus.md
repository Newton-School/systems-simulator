# 11. Replication, consistency and consensus

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

Covers the replication model, what a reader is allowed to see (consistency models), quorums, consensus (Raft),
leader election, and locks and leases: `etcd-consul-kv`, `leader-election`, `distributed-lock`,
`coordination-service`, and the replica behaviour of the storage nodes in chapter 09.

## 1. Why replicate, and what it costs

- **Durability** (a copy survives a failed machine), **availability** (another copy keeps serving) and **read scale** (replicas answer reads). The price: copies can **disagree**, and keeping them in step costs latency.
- The unavoidable trade: a write acknowledged to the client before all copies have it is fast but exposes **stale reads** and risks **lost writes** on failover; waiting for the copies is safe but slow, and unavailable if a copy is unreachable. [D: the CAP trade in section 4]

## 2. Primary-replica replication

One **primary** accepts writes and ships them to **replicas**. Choices:

| Mode                     | The primary acknowledges the client when...          | Write latency                      | Loses data on primary crash?    | Stale reads?                           |
| ------------------------ | ---------------------------------------------------- | ---------------------------------- | ------------------------------- | -------------------------------------- |
| **Asynchronous**         | it has applied the write locally                     | the primary's own time             | **yes**, writes not yet shipped | yes, by the replication lag            |
| **Semi-synchronous**     | at least one replica has **received** it (relay log) | primary + one round trip           | no, if that replica survives    | **still yes**: received is not applied |
| **Synchronous / quorum** | a required set of replicas has applied it            | primary + slowest required replica | no                              | no on those replicas                   |

[S: MySQL replication discussions; Percona] Important detail: **semi-sync is a durability feature, not a freshness feature**: a replica acknowledges after writing to its relay log, not after applying, so it can be far behind in apply yet still acknowledge. If replicas are slow or down the primary falls back to async after a timeout (default 10 s in MySQL). [S]

**Replication lag** is how far behind a replica is. Monitoring examples: warn at about 10 s, critical at about 60 s (rules of thumb). [S]

**Math [D]**

- Write latency, quorum: with write quorum W of n copies (including the primary), the write waits for the **(W − 1)th fastest follower**. Round trips to followers of 1, 5 and 80 ms: a 2-of-3 quorum commits in about **1 ms** (the fastest follower); waiting for all takes **80 ms**. Five copies with follower round trips 1, 2, 60 and 70 ms and a majority of 3: the second-fastest follower, **2 ms**.
- Staleness: a read arriving t after a write sees the old value if replication lag > t. With a fixed lag of 100 ms and reads uniformly spread over the 500 ms after a write, **20%** are stale. [computed]
- Failover: a failed primary is replaced by promoting a replica; during promotion writes are rejected, and under async replication the writes the replica never received are lost (the **recovery point**). Window = detection time + promotion time. [D]

**Testable expectations**

- Async: write latency = primary only; reads from a replica can be stale for up to the lag; failover can lose the last (lag x write rate) writes.
- Quorum: write latency rises with the slower required replica; reads from required replicas are never stale.
- A configured failover window rejects writes for exactly that long, then service resumes.

## 3. Consistency models

What a read is allowed to return. From strongest to weakest, with the guarantees as the models are usually defined [S: Jepsen consistency map, relationships only; definitions K]:

| Model                | Guarantee                                                                                                                                      | Availability under partition   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Linearizable**     | every operation appears to take effect at one instant between its start and end, in real-time order; a read returns the latest completed write | unavailable (needs a majority) |
| **Sequential**       | all processes see one order consistent with each process's own order, not necessarily real time                                                | unavailable                    |
| **Causal**           | if one operation could have caused another, everyone sees them in that order                                                                   | sticky available               |
| **Read your writes** | a client sees its own earlier writes                                                                                                           | sticky available               |
| **Monotonic reads**  | a client never sees data go backwards                                                                                                          | sticky available               |
| **Eventual**         | if writes stop, replicas converge                                                                                                              | total                          |

(Availability classes: _total_ = any live node can answer; _sticky_ = available if the client keeps talking to the same node; _unavailable_ = needs a majority.) [S: Jepsen]
Strict serializability is the transactional counterpart (serializable and linearizable). Snapshot isolation allows write skew. [S: Jepsen]

**How databases deliver stronger reads from replicas [S: MySQL/ProxySQL/MongoDB mechanisms]:** a replica read can wait until it has applied a given position (MySQL `WAIT_FOR_EXECUTED_GTID_SET`, MongoDB `afterClusterTime`, Raft ReadIndex), or the read goes to the primary for a short window after the user's own write ("sticky primary", often 1 to 2 s). Each costs latency or primary load.

**Testable expectations**

- Eventual reads from a lagging replica can return an old version; read-your-writes reads never return a version older than the session's own acknowledged write; strong reads never return anything but the newest committed version.
- Stronger models cost more read latency or capacity: a read that waits for the replica to catch up holds a worker for the wait.
- Leader reads are always up to date.

## 4. CAP and PACELC

- **CAP [S: Wikipedia]:** during a network **partition** a replicated store must choose between **consistency** (every read returns the latest write or an error) and **availability** (every non-failing node answers, possibly with old data). It is not "pick two of three at all times": without a partition you can have both. CAP consistency (linearizability) differs from ACID consistency, and CAP availability differs from "high availability". Many databases are configurable between the two.
- **PACELC (2010) [S]:** if **P**artitioned choose A or C; **E**lse (normal operation) choose **L**atency or **C**onsistency. The second half is the one you pay every day: stronger consistency costs round trips.

## 5. Quorums

For N replicas, write to W and read from R: **R + W > N** guarantees every read quorum overlaps every write quorum, so a read sees the latest acknowledged write (if no failures reshape the quorum). [S: Dynamo and course notes]

- N = 3, R = 2, W = 2: overlap (2 + 2 > 3). R = 1, W = 3: overlap, reads fast and writes need all. R = 1, W = 1: **no** overlap (2 is not > 3), fast and stale. [computed]
- **Sloppy quorums and hinted handoff** (Dynamo): when a replica is down, writes go to the next healthy nodes with a hint to hand them back; availability up, but **R + W > N no longer guarantees overlap** during failures, and divergent versions need reconciliation (vector clocks, last-writer-wins). [S]
- **Availability of a quorum.** If each replica is up independently with probability p, a quorum of k of n is available with probability the sum over i >= k of C(n, i) p^i (1 − p)^(n − i):

| Cluster | Needs | p = 0.99 each  | p = 0.999 each | Tolerates |
| ------- | ----- | -------------- | -------------- | --------- |
| 1 node  | 1     | 0.99           | 0.999          | 0         |
| 3       | 2     | **0.999702**   | 0.999997       | 1         |
| 5       | 3     | **0.99999015** | 0.99999999     | 2         |
| 7       | 4     | 0.99999966     | 1.0            | 3         |

[computed] Odd sizes are standard: 4 nodes need 3 for a majority and tolerate only 1, the same as 3 nodes.

## 6. Consensus: Raft

- **What it does:** a set of servers agree on one ordered log of commands so a replicated state machine behaves as one; it keeps going while a **majority** is available and **never returns an incorrect result** (it may stall instead). A cluster of n servers tolerates **floor((n − 1) / 2)** failures: 3 tolerates 1, 5 tolerates 2, 7 tolerates 3. [S: raft.github.io; derivation computed]
- **Leader election:** followers that hear no heartbeat within a **randomised election timeout** become candidates and request votes; a majority makes a leader. Typical timeouts are **150 to 300 ms**, randomised to avoid split votes, and must be much larger than the time to broadcast a heartbeat and get replies (broadcast time 0.5 to 20 ms, which puts the election timeout somewhere between 10 and 500 ms). [P: Ongaro and Ousterhout, In Search of an Understandable Consensus Algorithm, section 9.3: broadcastTime ≪ electionTimeout ≪ MTBF, "150–300ms" as the example interval]
- **Commit rule:** an entry is committed once stored on a majority; the leader replies to the client then. **Commit latency = one round trip to the quickest majority** = the fastest follower in a 3-node cluster, the second-fastest in 5 (plus a disk sync on each). [P: Raft paper, an entry is committed once replicated on a majority; the latency reading is derived]
- **Read consistency:** a leader read is linearizable only if it confirms it is still leader (a heartbeat round with a majority, or a lease). [P: Raft paper section 8: the leader exchanges heartbeats with a majority before answering a read-only request]
- **Availability gap during failover:** time without a leader = failure detection (up to one election timeout) + election. The Raft paper states the system is unavailable for roughly the election timeout when the leader crashes (so tens to hundreds of milliseconds in a local cluster; deployments tuned for slow or wide-area links configure longer). [P]
- Used by etcd and Consul (`etcd-consul-kv`, `coordination-service`); ZooKeeper uses a similar protocol (ZAB). Metadata that must be correct (locks, leader identity, configuration) belongs on such a store, not on a cache. [D: a cache can lose or evict the value; a consensus store cannot acknowledge a write it may lose]

**Testable expectations**

- With a majority up, writes commit; with a majority down, writes are refused (never silently accepted).
- Writes to a 5-node cluster commit after the second-fastest follower acknowledges.
- Killing the leader makes writes unavailable for about the election timeout, then they resume with a new leader.

## 7. Locks, leases and fencing

- A **lease** is a lock that expires after a duration, so a crashed holder does not block everyone forever.
- **The failure:** holder A takes a lease, **pauses** (garbage collection, VM stall) past its expiry, B takes the lease, A wakes still believing it holds it, and both write. Leases alone do not give mutual exclusion under pauses or clock drift. [S: Kleppmann on Redlock]
- **Fencing tokens:** the lock service issues a monotonically increasing number with each grant; the **protected resource** rejects any write carrying a smaller number than one it has already seen. Needs the resource to cooperate. [S]
- **Efficiency vs correctness:** for an efficiency lock (avoid duplicate work, an occasional double run is merely wasteful) almost any lock is fine; for a correctness lock (two holders corrupt data) use a consensus-backed service (ZooKeeper, etcd) and fencing. Redlock's safety depends on timing assumptions; Redis's author and Kleppmann agree fencing is stronger. [S]
- **Contention math:** with n clients competing for one lock held for h seconds, the maximum rate of lock-protected work is 1 / h; a lock turns a parallel system into a serial one at that point (Amdahl, chapter 06). [D]

## 8. Leader election

A group picks one leader for a role (primary, scheduler, singleton job). It is a consensus problem: use the consensus store's lease (etcd, ZooKeeper ephemeral nodes) rather than rolling your own. Safe use requires that the leader stops acting when it can no longer prove it holds the lease, and that downstream accepts only the newest leader (fencing). [S: Kleppmann, How to do distributed locking]

## 9. Conflict resolution when writes are accepted in several places

Multi-leader and leaderless systems must reconcile concurrent writes: **last-writer-wins** (simple, loses data), **vector clocks** (detect concurrency, return siblings to the application), and **CRDTs** (merge deterministically). [S: Dynamo; K]

## 10. Simulator parameter map

| Setting                                   | Meaning                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `replicationEnabled`, `replicationRole`   | `primary`/`leader`, `replica`/`follower`                                                                                   |
| `replicaMembers`                          | the followers of a primary                                                                                                 |
| `replicationLagMs`                        | delay before a follower applies a committed write                                                                          |
| `writeAckPolicy`                          | when a write is acknowledged: `primary` (the primary alone) or `quorum`                                                    |
| `consensusProtocol`, `conflictResolution` | named for the replicated store                                                                                             |
| `failoverUntilMs`                         | the simulated time (ms from the start of the run) until which the node rejects traffic while a promotion completes         |
| `electionTimeoutMs`                       | quorum stores: how long the store is unavailable after its leader fails before a follower is elected (needs a majority up) |
| `consistencyModel`                        | `eventual`, `monotonic-reads`, `read-your-writes`, `strong` for follower reads                                             |
| `readLatency`, `writeLatency`             | separate read and write service times                                                                                      |
| lock settings                             | `leaseMs`, `acquireMs`, `fencing`, `lockKeyField`                                                                          |

The simulator tracks a **version per key**: each write the leader finishes commits a new version; a follower applies it `replicationLagMs` later; a read returns the newest version its node has applied. A quorum write (`writeAckPolicy: quorum`) adds the replication wait to the write time and is acknowledged by W = floor(N/2) + 1 copies, so a given follower is already current at commit with probability (W − 1) / (N − 1) and otherwise applies it after the lag; this needs `replicaMembers` on every member so the cluster size is known, otherwise every follower is treated as current. It counts stale reads, read-your-writes violations and monotonic-read violations, and checks single-key register linearizability on the recorded history. [repo]

## 11. Testable expectations (summary)

- Follower read staleness: fraction of reads that return an old version = P(lag > time since write); zero for a strong model.
- A strong follower read waits for the replica and costs extra service time equal to the wait.
- R + W > N configurations show no stale reads while all replicas are healthy; R + W <= N shows stale reads.
- A majority quorum is available with the probability in section 5; fewer than a majority up means writes are refused.
- Lock with fencing: a write carrying an older token is rejected; without fencing, a delayed holder can overwrite a newer one.

## 12. Open items

- Read directly: the Raft paper and Kleppmann's locking article. Cited through summaries: Jepsen model definitions, the Dynamo paper (Princeton notes), Gilbert and Lynch's CAP proof (Wikipedia). DDIA chapters 5 and 9 are not cited.
- Decided and implemented: a quorum store takes `electionTimeoutMs`; while the leader is down it is unavailable for that long, then, with a majority up, the first healthy member of `replicaMembers` takes over as leader and requests addressed to the old leader reach it. Sloppy quorums are not modelled.

## Sources

- [The Raft consensus algorithm](https://raft.github.io/) [P]
- [CAP theorem, Wikipedia](https://en.wikipedia.org/wiki/CAP_theorem) [S]
- [Jepsen: consistency models](https://jepsen.io/consistency/models) [P, relationships only]
- [Dynamo (Princeton course notes on the SOSP 2007 paper)](https://www.cs.princeton.edu/courses/archive/spr22/cos418/docs/L10-dynamo.pdf) [S]
- [Percona: MySQL high availability, stale reads and how to fix them](https://www.percona.com/blog/mysql-high-availability-stale-reads-and-how-to-fix-them/) [S]
- [Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) [P]
- [Ongaro and Ousterhout, In Search of an Understandable Consensus Algorithm](https://raft.github.io/raft.pdf) [P]
