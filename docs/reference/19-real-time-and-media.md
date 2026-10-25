# 19. Real-time and media

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established knowledge or derived here,
not yet source-checked, **[?]** needs an owner decision. See [README](README.md).

The 6 `RealTimeType`s: `websockets-gateway`, `push-notification-service`, `transcoder`, `signaling-server`,
`sfu-mcu`, `webrtc-mesh`. Related: the TLS and connection set-up round trips (chapter 08), fan-out through a topic
(chapter 13), memory-bound capacity (chapter 06).

## 1. Long-lived connections

A request/response service holds a connection for milliseconds; a real-time gateway holds it for **minutes to
days**. Capacity is therefore set by **how many connections it can hold**, not by requests per second. [K]

- **WebSocket** starts as an HTTP request with `Upgrade: websocket`; the server answers `101 Switching Protocols`. The upgrade is one request/response **after** TCP (and TLS for `wss`), so a new connection costs the TCP and TLS round trips of chapter 08 plus one more. [P: RFC 6455]
- **Frame overhead:** 2 to 14 bytes per message (2-byte base header, +2 or +8 for long payloads, +4 for the masking key); client-to-server frames are always masked, server-to-client never. [P]
- **Control frames:** ping (0x9), pong (0xA) and close (0x8), each at most 125 bytes. Either side may start the close handshake. [P]
- **Keep-alive:** idle connections are dropped by NATs and load balancers after tens of seconds to minutes, so clients and servers send periodic pings. [K]

## 2. Connection capacity arithmetic

| Quantity                 | Formula                                      | Worked                                                                                                               |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Memory-bound connections | RAM / memory per connection                  | 16 GB / 32 KB = **524,288** per instance [computed]                                                                  |
| Heartbeat load           | connections / interval x cost per ping       | 100,000 / 30 s = 3,333 pings/s x 0.01 ms = 33 ms of CPU per second = **0.033 cores** [computed]                      |
| Reconnect storm          | clients x handshake cost / time to reconnect | 100,000 clients each needing a 2 ms TLS handshake = 200 s of CPU; across 16 cores **12.5 s** of full load [computed] |
| Concurrent connections   | arrival rate x session length (Little)       | 50 new users/s x 600 s = **30,000** held [computed]                                                                  |

- A fleet that cannot hold the offered connections **refuses the excess**: the limit is the smaller of the RAM cap and any per-instance connection cap. [K]
- **Thundering herd on restart:** when a gateway restarts, every client reconnects at once; jittered exponential backoff on the client spreads the load (chapter 02). [K]
- **Sticky routing.** A connection lives on one instance, so a load balancer's per-request balancing does not balance a long-lived connection; load follows the connection count at connect time. [K]

## 3. Push and fan-out

- **Fan-out cost:** pushing one event to N held connections costs N x (send cost); at 0.01 ms per send, **1,000,000 recipients = 10 s of CPU**, or 0.6 s spread over 16 cores. A single popular event can saturate a gateway even if request rate is low. [computed]
- **Delivered load = events x recipients**, not events (compare chapter 13 topics). [K]
- **Mobile push** (APNs, FCM) is a call out to the platform provider: asynchronous, rate-limited, best effort, with no delivery-time guarantee. It is an external dependency (chapter 20). [K]

## 4. Media pipelines

- **Transcoding** turns one input into several renditions (a **bitrate ladder**, for example 1080p, 720p, 480p, 360p). It is CPU or GPU bound; capacity = cores / (CPU-seconds per second of video x renditions). Live transcoding must run at **real time or faster** (real-time factor <= 1) or the stream falls behind. [K]
- **Signalling server:** exchanges the small messages (offer, answer, ICE candidates) that set up a call; low rate, latency-sensitive, no media. [K]

## 5. Multi-party video: mesh, SFU, MCU

N participants, each sending one stream of bitrate b:

| Topology                       | Upload per client      | Download per client  | Server                                      | Scales to                   |
| ------------------------------ | ---------------------- | -------------------- | ------------------------------------------- | --------------------------- |
| **Mesh** (peer to peer)        | (N - 1) b              | (N - 1) b            | none                                        | about 4 to 5 people         |
| **SFU** (selective forwarding) | b (or a simulcast set) | (N - 1) b            | forwards, no decode: egress N (N - 1) b     | tens of people              |
| **MCU** (mixing)               | b                      | b (one mixed stream) | decodes N, encodes mixed streams: heavy CPU | constrained clients, legacy |

[S: vendor and community summaries; no primary measurement found] Worked at b = 1.5 Mbps: mesh with N = 5 uploads **6 Mbps** per client; an SFU with N = 5 sends 5 x 4 x 1.5 = **30 Mbps** out; with N = 50 and everyone visible that is 50 x 49 x 1.5 = **3,675 Mbps**, which is why large calls show only a few active speakers or use simulcast layers. [computed]

## 6. Failure modes

- **Connection exhaustion:** RAM or file-descriptor limit reached; new connections are refused while existing ones work.
- **Reconnect storm** after a gateway or network blip.
- **Slow consumer:** a client that cannot keep up forces the server to buffer or drop; per-connection send buffers must be bounded.
- **Head-of-line blocking** on one TCP connection delays all messages behind a lost packet.
- **Media quality collapse** when the uplink cannot carry the stream: the sender must lower bitrate.

## 7. Simulator parameter map

| Setting                                                | Meaning                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `heldConnections`                                      | connections offered to the gateway fleet                                                      |
| `memPerConnectionKb` (32), `maxConnectionsPerInstance` | memory and cap per instance; the held count is the smaller of the offered, cap and RAM limits |
| `heartbeatIntervalMs`, `heartbeatCostMs` (0.01)        | keep-alive pings; cores kept busy = held / interval x cost                                    |
| `pushRecipients`, `pushSendMs` (0.01)                  | recipients per pushed event and CPU per send                                                  |

[repo] The connected share (held / offered) scales delivered pushes; excess connections are refused.

## 8. Testable expectations (summary)

- Held connections = min(offered, per-instance cap x instances, RAM / memory per connection).
- Heartbeat cores = held / interval x cost; they reduce the capacity left for requests.
- One event to N recipients costs N x send time; delivered messages = events x recipients x connected share.
- Offered connections above the cap are refused, not queued.
- Mesh upload grows linearly in N - 1; SFU upload stays constant; SFU egress grows as N (N - 1).

## 9. Open items

- Fetch and cite: RFC 6455 ping/pong and keep-alive sections; a primary source for SFU/MCU scaling (the mediasoup or Jitsi architecture docs); APNs and FCM rate limits; a transcoding real-time-factor benchmark.
- Decisions `[?]`: whether `sfu-mcu` and `webrtc-mesh` should model per-participant bandwidth or only a processing cost.

## Sources

- [RFC 6455: The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455) [P]
- [WebRTC network topology: mesh, SFU, MCU (Ant Media)](https://antmedia.io/webrtc-network-topology/) [S, vendor]
- [WebRTC multiparty video alternatives (BlogGeek.me)](https://bloggeek.me/?p=10262) [S]
- [SFU vs MCU vs mesh (Fora Soft)](https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-mcu-mesh-topologies) [S, vendor]
