# 09. Storage and databases

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 19 `StorageType`s: `relational-db`, `nosql-db`, `object-storage`, `block-storage`, `distributed-file-system`,
`in-memory-cache`, `search-index`, `time-series-db`, `columnar-db`, `graph-db`, `vector-db`, `data-warehouse`,
`data-lake`, `kv-store`, `archive-storage`, `schema-registry`, `cdc`, `backup-service`, `kms-storage`.
Caching is chapter 10; replication and consistency chapter 11; sharding chapter 12; the change stream and
backup flows touch chapter 13.

## 1. What a data store does and what limits it

A store holds data durably and answers reads and writes. Its limits are always one of: **I/O operations per second**
(IOPS), **bytes per second** (throughput), **CPU** (query execution, compression), **memory** (working set), **connections**,
or **capacity** (bytes). A request is slow when it waits behind one of those. [D: a request waits for its constrained resource, chapter 01]

Anchor numbers [S: "latency numbers" list circa 2012; order of magnitude only]:

| Operation                                 | Time   |
| ----------------------------------------- | ------ |
| Main memory reference                     | 100 ns |
| Read 4 KB randomly from SSD               | 150 us |
| Round trip within a datacenter            | 500 us |
| Read 1 MB sequentially from SSD           | 1 ms   |
| Disk seek                                 | 10 ms  |
| Read 1 MB sequentially from spinning disk | 20 ms  |

Rules of thumb that follow: memory is about 1,500x faster than an SSD random read; sequential access is far cheaper than random on every device (1 MB sequential from SSD in 1 ms against about 256 random 4 KB reads at 150 us each = 38 ms); and a network hop to the store costs more than the SSD read behind it.

## 2. I/O capacity: IOPS, throughput and queue depth

- **IOPS x I/O size = throughput.** Amazon EBS states it directly: throughput in MiB/s = IOPS x I/O size in KiB / 1,024. [P: AWS EBS docs]
- **gp3** (general purpose SSD): baseline **3,000 IOPS and 125 MiB/s**, independent of volume size; provision up to 80,000 IOPS and 2,000 MiB/s; throughput scales 0.25 MiB/s per provisioned IOPS (2,000 MiB/s needs 8,000 IOPS); single-digit-millisecond latency; no burst credits. [P]
- **gp2:** 3 IOPS per GiB (minimum 100, maximum 16,000), bursting to 3,000 IOPS from a credit bucket of 5.4 million credits. Burst duration = credits / (burst IOPS − baseline IOPS). A 100 GiB volume (300 IOPS baseline) bursts 5.4 M / 2,700 = **2,000 s** and needs 18,000 s to refill; a 750 GiB volume (2,250 baseline) bursts 7,200 s. [P, computed]
- Worked: 3,000 IOPS at 16 KiB = **46.9 MiB/s**, so the IOPS limit binds first; to reach 125 MiB/s you need 8,000 IOPS at 16 KiB, 500 IOPS at 256 KiB, or 32,000 IOPS at 4 KiB. Small random I/O is IOPS-limited, large sequential I/O is throughput-limited. [computed]
- **Queue depth (Little's Law, chapter 01).** A device that serves one 150 us random read at a time does 1 / 150 us = **6,667 IOPS** at queue depth 1; SSDs serve many in parallel, so throughput rises with queue depth until the device saturates. IOPS = outstanding requests / latency. [D from Little's law, computed]
- Saturation shows as latency rising with queue depth, exactly like any queue: expect the hockey stick (chapter 01 section 4.1).

**Testable expectations**

- A store with capacity C ops/s and service time S has C = workers / S; offered load above C builds a queue and then rejects.
- Throughput never exceeds IOPS x I/O size; the binding limit is whichever is lower.

## 3. Relational databases

- **Row storage on B-trees.** An index is a B-tree whose nodes are disk blocks; a lookup reads about **log_b(N)** blocks for fan-out b. N = 10⁶ rows at b = 100 is 3 reads (about 20 for a binary search); N = 10⁹ at b = 100 is 5 levels (4.5 rounded up); at b = 500, 4. Search, insert and delete are O(log N). [S: Wikipedia B-tree; levels computed] Upper levels are cached in memory, so a lookup is often one disk read.
- **Write-ahead logging (WAL).** A change must not reach a data file until the log record describing it is flushed. Commit needs only a sequential **fsync of the log**, not every dirtied data page; one fsync can commit many transactions (group commit). After a crash the log is replayed (roll-forward). Checkpoints bound recovery time. [P: PostgreSQL docs]
- **ACID transactions**, locks or MVCC for isolation, constraints, joins and a query planner. The cost: coordination, which limits write scaling to one primary (chapters 11 and 12).
- **Connection pools.** Each connection holds memory and a process or thread. Connections needed = queries per second x time per query (Little): 500 req/s x 20 ms = **10 connections**; far more than the database has cores usually only adds contention. [computed]
- Typical default in the simulator: 8 ms per point read, 16 ms per write (a log flush plus the data change), 42 ms per scan. [repo: storage profile]

## 4. NoSQL and the LSM-tree

- **Write path of an LSM-tree** (Cassandra, RocksDB, HBase): append to a write-ahead log, insert into an in-memory sorted buffer (memtable); when full, flush **sequentially** to disk as an immutable sorted file; updates write new entries and deletes write **tombstones**. **Compaction** merges files in the background. [S: Wikipedia LSM-tree]
- **Compaction trade-off:** leveling (one run per level) gives fewer files to read but more rewriting (higher write amplification); tiering (several runs per level) gives less rewriting but reads must check more files. Write amplification under leveling is O(T x L / B) for size ratio T, L levels and B entries per page. [S]
- **Bloom filters** let a lookup skip files that cannot contain the key. False-positive rate p = (1 − e^(−kn/m))^k: 10 bits per key with k = 7 gives **0.82%**; 8 bits with k = 6 gives 2.2%; the optimum k = (m/n) ln 2, and about 9.6 bits per key gives 1%. [S: Wikipedia, Bloom filter; computed]
- LSM favours **write-heavy** workloads (sequential I/O); mixed workloads can suffer because compaction competes for I/O and invalidates cached data. B-trees favour point reads and updates in place. [S]
- Real effect on capacity: effective device write rate = application writes x write amplification. A 10 MB/s write load at amplification 10 needs 100 MB/s of disk. The simulator models this with a write-amplification setting on storage capacity. [D, repo config] RocksDB's tuning guide gives a worked leveled-compaction estimate of 1 + 2 + 10 + 10 + 10 = 33 for a 500 GB database with a 10x level multiplier, and says universal compaction was introduced to reduce write amplification. [S: RocksDB wiki]
- Typical defaults: 4 ms for a NoSQL point read and 7 ms for a write; 1 ms for a key-value read. [repo: storage profile]

## 5. Object, block and file storage

- **Object storage (S3):** flat namespace of bucket + key; whole-object PUT and GET over HTTP; very high durability and capacity; **strong read-after-write consistency** for PUT and DELETE in all regions (since 2020): a read after a successful PUT returns the new data, a list after a PUT shows it; updates to one key are atomic; there are **no atomic updates across keys**; concurrent writes to a key resolve last-writer-wins. Bucket configuration remains eventually consistent. [P: AWS S3 docs]
- Latency is tens of milliseconds per request (simulator default: a 100 ms read and a 150 ms write); throughput scales by issuing many parallel requests; per-request overhead makes many small objects costly. [P: AWS S3 performance guide: roughly 100 to 200 ms for small objects and first byte, at least 5,500 GET and 3,500 PUT requests per second per prefix]
- Durability design target of 11 nines for standard classes. [P: AWS S3 storage classes: "designed to exceed 99.999999999%"; designed availability of Standard 99.99%]
- **Block storage (EBS-like):** a raw volume attached to one instance; IOPS and throughput limits as in section 2. **Distributed file system (HDFS-style):** large files split into blocks replicated across nodes; high sequential throughput, poor for small files. [K]
- **Archive storage:** cheap, slow retrieval (minutes to hours), minimum storage durations. **Backup service:** copies on a schedule; recovery point objective (RPO) = time since last backup; recovery time objective (RTO) = restore duration = data size / restore rate. [P: AWS S3 storage classes for archive retrieval (Glacier Flexible: minutes to hours, 90-day minimum; Deep Archive: 12 to 48 hours, 180-day minimum); definitions of RPO and RTO are standard]
  Worked: 2 TB restored at 200 MB/s takes 10,000 s, **2.8 hours**. [computed]

## 6. Analytical stores

- **Row vs column layout:** columnar stores read only the columns a query touches and compress each column well (similar values together). Vendor figures: 5 to 10x compression against 1.5 to 3x for row storage (rough). Columnar suits aggregations over many rows; point lookups and single-row updates are slower because a row must be reassembled. [S: columnar storage guides]
- **Data warehouse:** columnar, SQL, structured, loaded in batches (ETL, chapter 18); queries scan large ranges (simulator default: an 18 ms read and a 28 ms write). **Data lake:** raw files (often Parquet) in object storage, schema applied on read; cheap, flexible, slower (simulator default: 22 ms and 26 ms). [K]
- **Scan vs point read** is a real difference of orders of magnitude: a scan of n rows costs about n x per-row cost, a point read costs about log N index reads. The simulator's storage profile gives reads and scans different service times. [K, repo config]
- **Time-series databases** store timestamped samples append-mostly with time-range queries and downsampling; **search index** (inverted index) maps terms to documents, fast for text queries and slow to update; **graph databases** follow edges cheaply but need whole-graph partitioning thought. [K]

## 7. Vector databases

- Store embeddings and answer **nearest-neighbour** queries. Exact search is O(N x dimensions); approximate indexes trade recall for speed.
- **HNSW** (Malkov and Yashunin): layered proximity graphs; search starts at a sparse top layer and descends, giving about logarithmic cost in practice. Parameters: **M** (links per node; 16 to 32 typical, more for high recall and high dimension, costs memory), **efConstruction** (build candidate list; larger is better recall, slower build) and **ef** (query candidate list; larger is higher recall and higher latency). The logarithmic claim comes from secondary sources, not the paper's proofs. [S: implementation guides]
- Capacity planning is memory-bound: vectors x dimensions x 4 bytes plus graph links. 10 M vectors of 768 float32 dimensions is about **30.7 GB** before index overhead. [computed]

## 8. Schema registry, CDC, KMS storage

- **Schema registry:** stores message schemas and compatibility rules (backward, forward, full) so producers and consumers evolve safely; a small, read-heavy, cacheable service. [K]
- **CDC (change data capture):** reads the database's change log and publishes row changes as events; keeps derived systems (cache, search, analytics) in sync without dual writes. Ordering is per key or per partition (chapter 13). [K]
- **KMS storage:** durable store for keys, with access control and audit; reads are latency-sensitive and cached by clients. Wrapping and unwrapping keys is a CPU-bound call (chapter 15). [K]

## 9. Capacity, replication and cost arithmetic

- Raw size = rows x bytes per row; index overhead adds roughly 20% to 50%; **replication multiplies stored bytes**: 200 GB at 3 replicas is 600 GB. 10⁹ rows x 200 B = 200 GB. [D; the 20% to 50% index overhead is a rule of thumb, not a standard]
- Working set vs memory: if the hot set fits in memory most reads never touch disk (chapter 10); if not, hit ratio and tail latency fall sharply.
- Per-operation cost differs by store model: provisioned instance-hours, per-request (consumption) pricing, and per-GB storage and egress. The simulator's cost model has instance-based, per-million-request and per-GB lines. [repo]

## 10. Simulator parameter map

| Setting                                                                   | Meaning                                                                                                                                                                                                     | Real counterpart                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| default storage profile (point read / write)                              | relational 8 / 16 ms, NoSQL 4 / 7, key-value 1 / 2, object 24 / 36, search index 10 / 20, time-series 6 / 11, graph 9 / 13, vector 11 / 18, warehouse 18 / 28, lake 22 / 26; scans cost 3 to 6 times a read | typical request time; replaces an authored processing time |
| `resources`                                                               | instance type and count; io-bound by default for data nodes                                                                                                                                                 | database host                                              |
| `dataModel`, storage profile                                              | different read and scan service times                                                                                                                                                                       | point read vs scan                                         |
| `storageCapacityGb`, `initialStorageGb`, `storageWriteAmplification`      | capacity, initial data, amplification                                                                                                                                                                       | disk size and write amplification                          |
| `readLatency`, `writeLatency`                                             | per-operation service time distributions                                                                                                                                                                    | read/write cost split                                      |
| `replicationRole`, `replicaMembers`, `replicationLagMs`, `writeAckPolicy` | primary/replica model                                                                                                                                                                                       | chapter 11                                                 |
| `routingKeyField` and shard settings                                      | which shard owns a key                                                                                                                                                                                      | chapter 12                                                 |

## 11. Testable expectations (summary)

- Capacity = workers / service time; a database of 4 workers at 8 ms serves 500 queries/s.
- Reads cost less than scans in a profile that distinguishes them; the ratio equals the configured service-time ratio.
- Storage fills at write rate x write amplification x bytes per record; capacity exhaustion rejects writes.
- Restore time = data size / restore rate.
- Little: connections in use = query rate x query time.

## 12. Open items

- HNSW complexity: the paper's abstract claims logarithmic scaling [P: arXiv 1603.09320]; no measured figures are asserted here. DynamoDB per-partition limits are in chapter 12.
- Decided: index depth (reads costing more as data grows) and compaction stalls are not modelled.

## Sources

- [Amazon S3 storage classes](https://aws.amazon.com/s3/storage-classes/) [P]
- [Optimizing Amazon S3 performance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html) [P]
- [Bloom filter, Wikipedia](https://en.wikipedia.org/wiki/Bloom_filter) [S]
- [RocksDB tuning guide](https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide) [P]
- [HNSW, Malkov and Yashunin](https://arxiv.org/abs/1603.09320) [P, abstract]

- [B-tree, Wikipedia](https://en.wikipedia.org/wiki/B-tree) [S]
- [Log-structured merge-tree, Wikipedia](https://en.wikipedia.org/wiki/Log-structured_merge-tree) [S]
- [PostgreSQL: write-ahead logging](https://www.postgresql.org/docs/current/wal-intro.html) [P]
- [Amazon S3: what is S3 and its consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) [P]
- [Amazon EBS general purpose SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html) [P]
- [Latency numbers every programmer should know (circa 2012)](https://gist.github.com/jboner/2841832) [S]
- [Columnar storage guide (MotherDuck)](https://motherduck.com/learn-more/columnar-storage-guide/) [S, vendor]
