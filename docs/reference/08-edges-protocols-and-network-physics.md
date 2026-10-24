# 08. Edges, protocols and network physics

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established knowledge or derived here,
not yet source-checked, **[?]** needs an owner decision. See [README](README.md).

An **edge** is the connection between two nodes. It carries a request over some distance, at some bandwidth,
through some protocol, and it can lose or fail it. This chapter covers each of those, with the arithmetic.
Edge fields in the simulator: `mode`, `protocol`, `latency` (distribution and `pathType`), `bandwidth`,
`maxConcurrentRequests`, `packetLossRate`, `errorRate`, `weight`, `condition`, `fanoutFactor`, `connection`, `batching`.

## 1. The cost of one hop

A request crossing an edge pays, in order: **connection setup** (if no warm connection), **transmission** (putting the bytes on the wire),
**propagation** (the signal travelling), possible **queueing** at a busy link, and **retransmission** if packets are lost. [K]

time per hop = setup + queue wait + size / bandwidth + propagation (+ loss recovery)

### 1.1 Reference latencies [S: "latency numbers" list, circa 2012]

| Operation                                     | Time   |
| --------------------------------------------- | ------ |
| Main memory reference                         | 100 ns |
| Send 1 KB over a 1 Gbps network               | 10 us  |
| Read 4 KB randomly from SSD                   | 150 us |
| Round trip within the same datacenter         | 500 us |
| Read 1 MB sequentially from SSD               | 1 ms   |
| Disk seek                                     | 10 ms  |
| Round trip California to Netherlands and back | 150 ms |

These are order-of-magnitude anchors; hardware has improved, so use them for ratios (a cross-ocean hop is about 300x a same-datacenter hop), not as exact values.

## 2. Propagation delay

The signal speed in optical fibre is about c / 1.47, roughly **204,000 km/s**, so **about 4.9 us per km one way** and 9.8 us per km round trip. [S: fibre-latency measurements] (A common round "5 us/km" is one-way.)

- 1,000 km: 4.9 ms one way, **9.8 ms round trip**. [computed]
- New York to London (about 5,570 km great circle): round-trip floor **about 55 ms**; real paths are longer than the great circle and add switching, so measured values are higher. [computed floor]
- Within a region the floor is tens of microseconds; measured **between availability zones in one region is about 0.6 to 1.1 ms** on average (one AWS study across four regions: 0.61 to 1.13 ms), set mostly by switching, not distance. [S: secondary]
- Between two US regions latency is likely above 10 ms; a single-digit-millisecond design target belongs to availability zones, not regions. [S: AWS re:Post, not a measurement]

**Testable expectations**

- Latency grows with distance by about 4.9 us per km one way; doubling the distance doubles propagation.
- Same-rack < same-datacenter < cross-zone < cross-region < internet, each larger than the last.

### 2.1 What the simulator uses

Latency per path type is a log-normal (chapter 03) sampled once per hop:

| `pathType`     | median  | mean    | p99     | default bandwidth |
| -------------- | ------- | ------- | ------- | ----------------- |
| `same-rack`    | 0.30 ms | 0.32 ms | 0.61 ms | 10,000 Mbps       |
| `same-dc`      | 1.00 ms | 1.08 ms | 2.54 ms | 5,000 Mbps        |
| `cross-zone`   | 2.01 ms | 2.18 ms | 5.11 ms | 2,500 Mbps        |
| `cross-region` | 60.3 ms | 63.1 ms | 121 ms  | 1,000 Mbps        |
| `internet`     | 99.5 ms | 137 ms  | 640 ms  | 100 Mbps          |

Comparison with the numbers above [computed]: `same-dc` (median 1.0 ms) is about twice the 0.5 ms datacenter round trip; `cross-zone` (median 2.0 ms) is about twice the measured 0.6 to 1.1 ms inter-AZ averages; `cross-region` (60 ms) is plausible for a trans-continental US pair or a short trans-Atlantic one but too low for far pairs. **[?]** Owner to confirm whether these are meant as one-way or round-trip figures and whether to recalibrate cross-zone. The engine's own comment says the path-type defaults are round-trip figures, yet a hop pays one sample and responses do not traverse edges, so a hop's sample stands for the whole exchange.

## 3. Transmission delay and bandwidth

**transmission time = size / bandwidth.** [K]

- 1 KB at 1 Gbps = 8 us (the reference list says 10 us). 1 MB at 100 Mbps = **80 ms**. The simulator uses size_bytes / (Mbps x 125) ms, which gives 0.008 ms for 1,000 bytes at 1,000 Mbps. [computed]
- A link is a **FIFO server**: transfers that arrive while an earlier one is still serialising wait. Throughput can never exceed bandwidth; offered load above it builds a queue exactly like a node (chapter 01).
  Utilisation of a link = offered bits per second / bandwidth.
- **Bandwidth-delay product** BDP = bandwidth x round-trip time: the data in flight to keep the pipe full. [S: Wikipedia] 1 Gbps x 70 ms = **8.75 MB**; 100 Mbps x 100 ms = 1.25 MB; a 2 Mbps DSL line at 50 ms = 12.5 kB. A TCP window smaller than the BDP leaves the link idle; without window scaling TCP caps at 65,535 bytes. [S]
- Rule: for small requests (a few KB) latency is dominated by propagation; for large transfers (MB) by size / bandwidth.

**Testable expectations**

- A request of S bytes on a link of B Mbps adds S / (B x 125) ms of transmission delay.
- Offered traffic above the bandwidth makes the link's queue wait grow; delivered rate equals the bandwidth.
- A 1 MB payload on a 100 Mbps edge adds about 80 ms; on a 10,000 Mbps edge about 0.8 ms.

## 4. TCP, TLS and what a new connection costs

- **TCP** needs a three-way handshake: **1 round trip** before any data moves. [S: RFC 6928 context; K]
- **TLS 1.2** adds **2 round trips**; **TLS 1.3** adds **1**; **TLS 1.3 resumption with 0-RTT** lets the client send data in its first flight (replayable, so only safe for requests that can be repeated). [S: secondary summaries of RFC 8446]
- So the time to the first response byte on a fresh HTTPS connection, with round-trip time R and a server that answers instantly [computed]:

| Case                               | Round trips | At R = 60 ms | At R = 1 ms |
| ---------------------------------- | ----------- | ------------ | ----------- |
| Reused connection (keep-alive)     | 1           | 60 ms        | 1 ms        |
| New, TLS 1.3 with 0-RTT resumption | 2           | 120 ms       | 2 ms        |
| New, TLS 1.3                       | 3           | 180 ms       | 3 ms        |
| New, TLS 1.2                       | 4           | 240 ms       | 4 ms        |

- **Slow start:** a new connection starts with an initial congestion window of up to **10 segments (about 14.6 KB)** and roughly doubles it each round trip. [S: RFC 6928] A 100 KB response (about 70 segments) needs about 3 data round trips after the handshake: 10, 20, 40 segments, so about **4 round trips** from a cold start. [computed]
- **Simulator behaviour (observed, flows `E-06`):** with a shared client identity the numbers above hold exactly: per-request TLS 1.2 costs 4 round trips, TLS 1.3 costs 3, resumed TLS 1.3 costs 2 and a resumed TLS 1.2 costs 3; keep-alive and persistent connections pay the handshake only on the first request (4 round trips for TLS 1.2, 3 for TLS 1.3), then 1. **Connections belong to a client**: a request with no client identity is treated as a new client, so without sessions every request pays the full setup even on a keep-alive edge, and resumption never applies. Give the workload a session count to model reuse.
- Lesson: **connection reuse is the biggest latency lever on long paths.** At cross-region distances a new TLS 1.2 connection costs 4x one warm request.

**Testable expectations**

- With `reuse: per-request` every request pays setup; with `keep-alive` only the first does; `persistent` never closes.
- Setup cost is a multiple of the edge round trip: TCP 1x, plus TLS 1.2 2x or TLS 1.3 1x.
- TLS session resumption reduces the repeat handshake (1.2: one round trip; 1.3: zero).

## 5. Packet loss

- A lost packet costs a retransmission. Loss also **throttles TCP throughput**: the **Mathis model** (Mathis, Semke, Mahdavi and Ott, 1997) bounds a sustained connection at
  **rate <= (MSS / RTT) x C / sqrt(p)**, with C about 1.22 (sqrt(3/2)) when every packet is acknowledged, 0.87 with delayed acks. It assumes light to moderate loss and no timeouts; Padhye et al. is more accurate above p of about 2%. [S]
- Worked, MSS = 1,460 bytes, RTT = 50 ms [computed]: p = 0.01% gives **28.6 Mbit/s**; p = 0.1% gives **9.05 Mbit/s**; p = 1% gives **2.86 Mbit/s**, whatever the link capacity. Loss, not bandwidth, can be the limit on long paths.
- A request of k packets is hit if any is lost: P = 1 − (1 − p)^k. With p = 1% and k = 10, **9.6%**. [computed] Large responses suffer more often than small ones.
- Recovery waits for a timeout when there are too few later packets to trigger fast retransmit (typical minimum retransmission timeout around 200 ms on Linux), so a lost packet can cost far more than one round trip. [K]
- UDP does no retransmission: a lost datagram is gone unless the application handles it (QUIC, DNS, games, real-time media). [K]
- **Simulator behaviour (observed, flows `E-08`):** a lost packet adds **one extra edge latency** (a fast-retransmit round trip) and never fails the request: at 20 ms latency and 10% loss about 10% of requests take 41 ms instead of 21 ms, and none fail. The probability a one-packet request is hit is p. The Mathis throughput bound is **not modelled**: loss never lowers delivered bandwidth, and a retransmission timeout (hundreds of ms) is not modelled either, so heavy-loss paths look better in the simulator than in reality (`E-08b`, parked).

## 6. Protocols

| Protocol           | Layer and style                             | Request pairing                                                                 | Key behaviour                                                                                   |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `https` (HTTP/1.1) | text over TCP and TLS                       | one request in flight per connection                                            | head-of-line blocking per connection; needs many connections for concurrency                    |
| `grpc` (HTTP/2)    | binary over TCP and TLS                     | many concurrent streams per connection                                          | multiplexing; RFC 9113 recommends a concurrent-streams limit **no smaller than 100** [S]        |
| `tcp`              | raw byte stream                             | database and cache wire protocols, typically one query at a time per connection | pool size sets concurrency                                                                      |
| `udp`              | datagrams                                   | none                                                                            | no handshake, no retransmission, no ordering                                                    |
| `websocket`        | long-lived full-duplex over an HTTP upgrade | frames, not request-response                                                    | one extra round trip to upgrade, then no per-message setup; connection state held at the server |
| `amqp`             | broker messaging over TCP                   | channels over one connection                                                    | application handshake after TCP and TLS                                                         |
| `kafka`            | broker protocol over TCP                    | produce and fetch requests                                                      | batching, acks, partitions (section 8)                                                          |

### 6.1 Connection pools and Little's Law

Connections needed = concurrent requests / requests per connection, and concurrent requests = rate x latency (chapter 01).

- HTTP/1.1, 2,000 req/s at 50 ms: 2,000 x 0.05 = **100 concurrent**, so about 100 connections. With HTTP/2 and 100 streams per connection, **1 connection** carries it. [computed]
- A pool smaller than the concurrent demand makes requests wait for a free connection: a queue in front of the link, separate from the server's own queue. That wait must be reported distinctly (the simulator calls it edge connection wait).
- Idle connections time out (keep-alive idle timeout, simulator default 60 s); after that the next request pays setup again. [repo default]

**Testable expectations**

- Pool of m connections, per-request time W: maximum throughput = m / W for HTTP/1.1 style, m x streams / W for multiplexed.
- With a pool of 10 and 50 ms requests, throughput caps at 10 / 0.05 = **200 req/s** whatever the server can do.

## 7. Synchronous, asynchronous, streaming and conditional edges

| `mode`         | Meaning                          | Effect on the caller                                                                          |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `synchronous`  | wait for the response            | latency adds to the caller's time; failure propagates                                         |
| `asynchronous` | fire and continue (queue, event) | caller returns after handing off; downstream latency is hidden; load still arrives downstream |
| `streaming`    | long-lived, many messages        | no per-message setup                                                                          |
| `conditional`  | taken only if a condition holds  | splits traffic by rule                                                                        |

- Asynchronous does **not** remove load: the downstream still receives every message. It removes the caller's wait and decouples availability. [K]
- **Simulator behaviour (observed, flows `E-11`):** an asynchronous edge **forks a side branch** next to the synchronous continuation. The branch still loads its target (every request arrives there) and is reported as its **own request**, so a service with a 3 ms synchronous path and a 200 ms asynchronous side branch shows a blended p99 of about 200 ms while the user-facing path takes about 5 ms. Read per-branch latency, not the blended percentile, for user experience. If a node has **no** synchronous continuation, the asynchronous branch simply is the request and the caller waits. Queue and stream node types are asynchronous **by type** and detach the caller automatically. Two synchronous targets are a split (each request goes to one), not a fork.

## 8. Batching (Kafka-style)

Producers group records into **batches** to cut per-request overhead. `linger.ms` is how long to wait for more records; `batch.size` is the byte size that triggers an immediate send. A batch is sent when **either** limit is reached. [S]

- Kafka 4.0 changes the `linger.ms` default from 0 to **5 ms** (KIP-1030). [S] (The `batch.size` default, 16 KB in earlier versions, was not confirmed here.)
- **The first record in a batch waits min(linger, time to fill); the average record waits less.** A batch that fills holds records that arrived at different times: with n records at gap g the waits are 0, g, ..., (n − 1) g, an average of (n − 1) g / 2. Five records at 1,000 req/s (g = 1 ms) fill in 5 ms but wait 2 ms on average, which is what the simulator shows (`E-12`); a record alone in its batch waits the whole linger (about 10 ms at 10 req/s with `linger.ms = 10`).
- Added latency for the first record = min(linger, time to fill the batch). At 10,000 records/s of 1 KB on one partition, a 16 KB batch fills in 1.6 ms, so `linger.ms = 5` never waits the full 5 ms; at 100 records/s the batch never fills and every record waits the full linger. [computed]
- Trade: larger batches give higher throughput and compression ratios at the cost of added latency per record.

## 9. Fan-out

A fan-out factor f multiplies the load a request creates downstream: one post written to f followers is f writes. Downstream arrival rate = f x source rate. A factor of 500 on 100 posts/s is 50,000 writes/s, which can saturate a node that the source rate alone never would. [K, chapter 24]

## 10. Errors on the wire

- `errorRate` is the chance a request over this edge fails (for example a reset or refused connection); `packetLossRate` is the chance a packet is lost and must be retransmitted. They are different failures: errors fail requests, loss delays them. [K]
- A failure rate e per hop gives a path success rate of the product of (1 − e) over hops. Five hops at 1% each: 95.1%. [computed: 0.99^5]

## 11. Simulator parameter map

| Edge field                                             | Unit                                      | Meaning                                                                                      |
| ------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `latency.distribution`                                 | ms                                        | per-hop delay sample (default is the log-normal for the path type)                           |
| `latency.pathType`                                     | n/a                                       | `same-rack`, `same-dc`, `cross-zone`, `cross-region`, `internet`                             |
| `bandwidth`                                            | Mbps                                      | link capacity; transmission = bytes / (Mbps x 125) ms                                        |
| `maxConcurrentRequests`                                | count                                     | limit on in-flight requests on this edge                                                     |
| `protocolOverheadMs`                                   | ms                                        | per-request protocol cost: https 0.5, grpc 0.2, tcp 0, udp 0, websocket 0.1, amqp 1, kafka 2 |
| `packetLossRate`, `errorRate`                          | 0 to 1                                    | loss and error probabilities                                                                 |
| `fanoutFactor`                                         | multiplier                                | deliveries per request                                                                       |
| `connection.reuse`                                     | `per-request`, `keep-alive`, `persistent` | connection lifecycle                                                                         |
| `connection.tls`                                       | `none`, `1.2`, `1.3`                      | handshake version                                                                            |
| `connection.maxConnections`, `maxStreamsPerConnection` | count                                     | pool and multiplexing limits                                                                 |
| `batching.lingerMs`, `maxBatchBytes`                   | ms, bytes                                 | Kafka batching (kafka edges only)                                                            |

**Connector mode.** In the default environment connections are plain wires and every field above is ignored at run time (the importer says so; chapter-level flows `M-01` to `M-05`). Test edge physics in the network environment.

## 12. Testable expectations (summary)

- Two nodes, edge latency L ms, service time S ms, no queueing: end-to-end latency = L + S + protocol overhead (network mode).
- Error rate e on the only edge: failed fraction e.
- Offered traffic above `bandwidth`: delivered rate equals bandwidth; link queue wait grows.
- New connection costs 1 (TCP) + 2 (TLS 1.2) or 1 (TLS 1.3) round trips; a reused connection costs none.
- Pool of m connections at W seconds each caps throughput at m / W.
- Batching: record latency added = min(linger, batch fill time).
- Fan-out f multiplies downstream arrivals by f.

## 13. Open items

- Fetch and cite: RFC 8446 and RFC 9113 text; Mathis et al. 1997; Kafka producer configuration page for defaults; AWS Network Manager inter-region latency figures; QUIC (RFC 9000) for the combined handshake.
- Decisions `[?]`: one-way or round-trip meaning of path-type latency; whether to recalibrate `cross-zone`; how response transfer should be charged since responses do not traverse edges.

## Sources

- [Latency numbers every programmer should know (list, circa 2012)](https://gist.github.com/jboner/2841832) [S]
- [Bandwidth-delay product, Wikipedia](https://en.wikipedia.org/wiki/Bandwidth-delay_product) [S]
- [RFC 6928: Increasing TCP's Initial Window](https://datatracker.ietf.org/doc/html/rfc6928) [P]
- [Mathis, Semke, Mahdavi, Ott: The macroscopic behavior of the TCP congestion avoidance algorithm, CCR 1997](https://courses.cs.duke.edu/fall24/compsci514/readings/mathis-tcpmodel-ccr97.pdf) [P]
- [Dissecting latency in the Internet's fiber infrastructure](https://arxiv.org/pdf/1811.10737) [S]
- [KIP-1030: change defaults, including linger.ms](https://cwiki.apache.org/confluence/display/KAFKA/KIP-1030:+Change+constraints+and+default+values+for+various+configurations) [P]
- [RFC 9113: HTTP/2 (SETTINGS_MAX_CONCURRENT_STREAMS)](https://datatracker.ietf.org/doc/html/rfc9113) [P, guidance read via mailing-list copy]
