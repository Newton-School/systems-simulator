# 07. Network nodes and routing

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 17 `NetworkType`s: `load-balancer`, `load-balancer-l4`, `load-balancer-l7`, `global-traffic-manager`,
`edge-router`, `nat-gateway`, `transit-gateway`, `vpn-gateway`, `cdn`, `api-gateway`, `service-mesh`,
`ingress-controller`, `reverse-proxy`, `high-perf-nic`, `network-policy`, `routing-rule`, `routing-policy`.
This chapter covers how each moves requests and the math behind choosing where a request goes. The cost of the
links between nodes is chapter 08.

## 1. What these nodes do

They sit **between** callers and servers and make one of five decisions. [D: the classification used by this chapter]

| Decision                                    | What it does                                                  | Nodes                                                                 |
| ------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Spread** requests over equivalent servers | pick a target by an algorithm; remove unhealthy ones          | `load-balancer`, `-l4`, `-l7`, `ingress-controller`, `reverse-proxy`  |
| **Route** by content or policy              | choose among different services by path, host, header, weight | `api-gateway`, `routing-rule`, `routing-policy`, `ingress-controller` |
| **Cache or offload**                        | answer without reaching the origin                            | `cdn`, `reverse-proxy`                                                |
| **Connect networks**                        | translate or tunnel between address spaces                    | `nat-gateway`, `vpn-gateway`, `transit-gateway`, `edge-router`        |
| **Add cross-cutting behaviour**             | encrypt, authenticate, retry, observe on every call           | `service-mesh`, `api-gateway`, `network-policy`                       |
| **Steer globally**                          | send users to a region                                        | `global-traffic-manager` (also chapter 21)                            |

Each is also a **queue with a capacity** (chapter 01): a load balancer that is too small is the bottleneck for everything behind it.
The simulator gives each a default instance and a small default service time (L4 balancer 0.15 ms, L7 0.4 ms, reverse proxy 0.5 ms, API gateway 1 ms, NAT 0.5 ms, VPN gateway 2 ms, CDN 2 ms). [repo config]

## 2. Layer 4 versus layer 7

- **Layer 4 (transport)** balancers route on IP and port (TCP/UDP). They do not look inside the request, so they are fast and cheap, preserve connections end to end, and cannot route by URL. [S: Wikipedia, Load balancing: content-aware switching routes on request content, which requires terminating the connection]
- **Layer 7 (application)** balancers terminate the connection, parse HTTP or gRPC, and route on path, host or header; they can terminate TLS, retry, rewrite and authenticate. That costs more CPU per request. [S: same]
- AWS describes the same split: an Application Load Balancer works on requests (layer 7), a Network Load Balancer on connections (layer 4), a Gateway Load Balancer for inline appliances. [P: AWS Elastic Load Balancing docs, structure only fetched]
- Consequence for the model: an L7 node has a **higher service time** than an L4 node at the same load (simulator defaults 0.4 ms vs 0.15 ms), and **only L7 can split by request type**. [repo defaults; the split follows from the previous two bullets]

**Testable expectations**

- Same traffic through L4 and L7 with identical capacity: L7 shows the higher per-request latency and utilisation.
- A path-based split works through an L7 node; an L4 node cannot route by request type.

## 3. Load-balancing algorithms

Choosing a target among n equivalent servers. Each algorithm, the information it needs and where it fails. [P: NGINX docs for the named methods; the rest K unless marked]

| Algorithm                      | Rule                                                              | Strength                                                         | Weakness                                                         |
| ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Round robin**                | take servers in turn                                              | simple, even request counts                                      | ignores that requests differ in cost and servers differ in speed |
| **Weighted round robin**       | in turn, proportional to weights                                  | handles unequal machines: weights 3, 1, 1 send 60%, 20%, 20% [P] | static; ignores current load                                     |
| **Random**                     | pick uniformly                                                    | no shared state                                                  | uneven in the short term                                         |
| **Least connections**          | send to the server with the fewest active connections [P]         | adapts to slow requests                                          | needs shared state; "connections" is a proxy for load            |
| **Least response time**        | lowest average latency and fewest active (NGINX `least_time`) [P] | adapts to slow servers                                           | noisy; can pile onto a fast server                               |
| **Power of two choices (P2C)** | pick 2 at random, send to the less loaded                         | near-optimal balance with almost no state                        | needs a load signal for 2 servers                                |
| **IP hash**                    | hash of client address picks the server [P]                       | same client reaches the same server (affinity)                   | uneven if few clients; moves many clients when the pool changes  |
| **Hash on key**                | hash of a chosen key (URL, user id)                               | cache locality, session affinity                                 | hot keys overload one server                                     |
| **Consistent hashing**         | key and servers on a ring (below)                                 | few keys move when the pool changes                              | needs virtual nodes to be even                                   |
| **Sticky sessions**            | remember the first choice per client                              | stateful apps                                                    | defeats balancing; a dead server loses its clients               |
| **Broadcast**                  | send to all                                                       | replication, fan-out                                             | multiplies load by n                                             |

### 3.1 Why least-loaded beats random: power of two choices [S: Mitzenmacher's thesis, abstract and book chapter]

Throw n balls into n bins. With **one random choice** the fullest bin holds Theta(ln n / ln ln n) balls with high probability. With **two choices** (place in the less full of two random bins) the maximum drops to **ln ln n / ln 2 + O(1)**: an exponential improvement. A third choice only shaves a constant factor. [S]

- n = 1,000: ln n / ln ln n = 3.57 vs ln ln n / ln 2 = 2.79; n = 10⁶: 5.26 vs 3.79; n = 10⁹: 6.84 vs 4.37. (Asymptotic leading terms, constants omitted.) [computed]
- Practical lesson: **two samples capture almost all the benefit of full knowledge**, which is why NGINX offers `random two` and many proxies use P2C. [P: NGINX]

### 3.2 Consistent hashing [S: Wikipedia; origin Karger et al. 1997]

Servers and keys are hashed onto a ring; a key belongs to the first server clockwise. [S]

- Adding a server moves only about **1 / (N + 1)** of the keys (those between it and its neighbour); removing one moves about 1 / N. [S]
- **Observed (flows `N-06`, 64 virtual points per server):** growing 9 to 10 servers moved 9.5% of 50,000 keys (theory 10%) against 89.8% for `hash mod n`; growing 4 to 5 moved 17.6% (20%) against 79.7%. Removing a server moved only the keys that server owned.
- **Compare** `hash mod n`: changing n from 9 to 10 leaves a key where it was only about 1 time in 10, so **about 90% of keys move**, against about **10%** on a ring. [computed]
- **Virtual nodes:** with few servers, ring positions cluster and arcs differ widely; hashing each server to many points evens the load and spreads a failed server's keys over many successors instead of doubling one neighbour. [S]
- Used for cache fleets and sharded stores (chapter 12): a moved key is a cache miss, so fewer moves means a smaller miss storm.

### 3.3 Expected results to test

Round robin over n identical servers with constant arrivals: each gets exactly 1/n. Weighted 3:1:1: shares 0.6, 0.2, 0.2. Random: shares near 1/n with sampling noise of sqrt(p (1 − p) / N).

- Least-connections with one slow server (2x service time): the slow server receives about half the requests of a fast one, so queue lengths even out; round robin leaves the slow server saturated first. [D: least-connections equalises in-flight work, so by Little's law the slow server completes half the rate]
- Hash on key with Zipf keys (chapter 05): the hottest key's server carries at least that key's share. With s = 1.0 over 1,000 keys, one key is 13.4% of traffic, so a server holding it carries more than 13.4% however many servers there are. [computed]
- Sticky: all requests from one client reach one server until it fails. **Simulator keys (observed):** `sticky` pins by `sessionId` (or the canonical key, or `stickyKeyField`); `ip-hash` pins by `clientIp` only, so a workload that sets sessions but no client address is not pinned by `ip-hash`.

## 4. Health checks and removing servers

See chapter 02 section 7. Detection delay (interval x consecutive failures) is the time a dead server still gets traffic.

- After one of n equal servers is removed, each survivor carries n / (n − 1) of its previous load: 4 servers at 75% become 100%. [D]
- Balancers use two signals: **active** probes and **passive** outlier detection (consecutive failures; NGINX `max_fails` default 1 within `fail_timeout`, then the server is skipped and re-probed with live traffic). [P: NGINX]
- When every target is unhealthy a balancer either serves anyway or fails; the choice should be explicit. **[?]** The simulator **fails**: it rejects with `no_healthy_targets`.
- **Ejection can amplify an overload (observed).** A server is ejected after a single failed attempt, for a window. At a mild overload of 10% (220 req/s into 200 req/s of capacity) a few rejections at each server eject both, and the balancer then rejects about 85% of traffic: goodput 33 req/s against 200 req/s of capacity. With health ejection off the same fleet serves 198.8 req/s. Real balancers soften this: Envoy's **panic threshold** serves to all hosts when too many are ejected; NGINX's `max_fails` and `fail_timeout` (default one failure for 10 s) behave like the simulator. Teaching consequence: a balancer with aggressive passive ejection can turn a slight overload into an outage, which is the retry-storm and metastable-failure story of chapter 22. Tracked as `N-16`.

## 5. API gateway, ingress controller and reverse proxy

- **Reverse proxy:** accepts requests for backends, can terminate TLS, cache, compress, rate-limit. **Ingress controller:** the same role for a Kubernetes cluster, routing by host and path to services. **API gateway:** adds auth, quotas, request transformation and throttling in front of APIs. [D: definitions]
- **Throttling is a token bucket.** Amazon API Gateway limits steady-state rate and a burst per account and region, returns 429 when exceeded; historically 10,000 req/s with a burst of 5,000 (dated, check current quotas). [S: AWS announcement and docs]
  Token bucket maths: chapter 02 section 4.
- Everything in the request path adds its own latency and its own failure probability; the path's availability is the product of the hops' availabilities. Three hops at 99.9% give 99.7%. [D]

## 6. CDN and caching proxies

- Users are routed to a nearby **edge**; a hit returns immediately, a miss goes to the **origin** and the response is cached for later requests. [S]
- **Origin shield / tiered cache:** a regional layer between edges and origin; an edge miss asks the shield first, so the origin sees far fewer misses and the shield's cache is warmer because it serves many edges. [S]
- Lifetime is controlled by `Cache-Control`: `s-maxage` for shared caches (CDN), `max-age` for browsers, `no-store` and `private` disable caching, and unnormalised query strings or varying headers fragment the cache. [S]
- Hit ratio benchmarks vary by source (static content 95% to over 99%, personalised API responses 30% to 70%); treat as ranges, not targets. [S, disputed between sources]

**Maths [D]**

- Origin request rate = (1 − h) x total rate, where h is the hit ratio. At h = 0.95 the origin sees **5%** of traffic; at 0.99, **1%**. A CDN drop from 99% to 95% quintuples origin load.
- Mean latency = h x t_edge + (1 − h) x (t_edge + t_origin). With t_edge 10 ms, t_origin 120 ms, h = 0.95: **16 ms**; at h = 0.50: 70 ms.
- With a shield of hit ratio h2 on edge misses, origin load = (1 − h) x (1 − h2) x rate.

**Testable expectations**

- Origin arrivals = (1 − h) x edge arrivals, within sampling error.
- Cold start: hit ratio is low until the cache warms; a flush returns it to zero then recovers (chapter 10).

## 7. Service mesh and sidecar

- A **service mesh** puts a proxy beside each service to give uniform mutual TLS, retries, circuit breaking and telemetry without changing application code. [S: Istio documentation]
- The tax: about 0.20 vCPU and 60 MB per 1,000 req/s per sidecar in Istio 1.24's published test (earlier releases: 0.35 to 0.5 vCPU); every call crosses two sidecars. [P: Istio docs]
- The simulator's `service-mesh` node is a small queue on the path (default 0.6 ms); behaviours such as retries and breakers are configured as resilience settings on the calling node (chapter 02).

## 8. NAT, VPN, transit gateway, edge router, NIC, network policy

| Node                 | Real role                                              | What matters for capacity                                          |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| NAT gateway          | lets private hosts reach outside; translates addresses | throughput and connection-table limits, a per-GB data charge       |
| VPN gateway          | encrypted tunnel to another network                    | encryption CPU cost, bandwidth, a single tunnel is a bottleneck    |
| Transit gateway      | hub connecting many networks                           | per-attachment bandwidth, per-GB cost                              |
| Edge router          | border between networks                                | routing and bandwidth                                              |
| High-performance NIC | faster network card (offload, RDMA)                    | removes the host as a network bottleneck                           |
| Network policy       | allow or deny rules between workloads                  | adds a small per-packet check; blocks traffic that should not flow |

Numeric limits differ by provider and change; fetch current quotas before using them as oracles. The rows describe roles, not numbers; no quota is asserted here.

## 9. Global traffic steering

Directing users to the nearest or healthiest region (geo, latency, weighted and failover policies) is mostly DNS-based; see chapter 21. At the network layer **anycast** advertises one IP from many places so routing delivers users to the nearest. [S: Wikipedia, Anycast]

## 10. Simulator parameter map

| Setting                                    | Meaning                                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `routingStrategy`                          | `round-robin`, `weighted`, `random`, `least-conn`, `least-response-time`, `p2c`, `sticky`, `ip-hash`, `broadcast`, `conditional`, `passthrough` |
| edge `weight`                              | relative weight for the `weighted` strategy                                                                                                     |
| edge `condition`                           | expression for `conditional` routing (L7 only in practice)                                                                                      |
| `healthCheckEnabled`                       | remove unhealthy targets from routing (default on)                                                                                              |
| `config.routingKeyField`, `stickyKeyField` | request field used for hash and sticky routing                                                                                                  |
| content routing rules                      | route by request type, path or header                                                                                                           |

## 11. Testable expectations (summary)

- Round robin shares 1/n exactly for even arrivals; weighted shares equal normalised weights.
- P2C maximum queue length is far below random assignment at the same load, and close to least-connections.
- Hash routing: one key always lands on one server; adding a server moves about 1 / (N + 1) of keys with consistent hashing, about N / (N + 1) with modulo.
- Load balancer failure removes its whole subtree from service: a single LB is a single point of failure.
- Per-request latency through a gateway = queue wait + gateway service time; for a lightly loaded L7 node about its 0.4 ms service time.

## 12. Open items

- Karger et al. 1997, Maglev, and the Envoy and HAProxy documentation are not read directly; consistent hashing is sourced from Wikipedia and measured in the e2e flows `N-06`. Provider quotas for NAT, VPN and transit are deliberately not asserted.
- Decisions `[?]`: behaviour when all targets are unhealthy; (decided: least-connections counts in-flight requests).

## Sources

- [Multiple-choice allocation: Mitzenmacher, The Power of Two Choices in Randomized Load Balancing](https://www.eecs.harvard.edu/~michaelm/abstracts/mythesis.html) [P]
- [Load balancing, Wikipedia](<https://en.wikipedia.org/wiki/Load_balancing_(computing)>) [S]
- [Anycast, Wikipedia](https://en.wikipedia.org/wiki/Anycast) [S]
- [NGINX HTTP load balancing (random two)](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/) [P]
- [Istio performance and scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) [P]

- [NGINX HTTP load balancing](https://nginx.org/en/docs/http/load_balancing.html) [P]
- [Consistent hashing, Wikipedia](https://en.wikipedia.org/wiki/Consistent_hashing) [S]
- [Mitzenmacher, The Power of Two Choices in Randomized Load Balancing (thesis)](https://www.eecs.harvard.edu/~michaelm/postscripts/mythesis.pdf) [S, abstract]
- [AWS Elastic Load Balancing](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html) [P]
- [Istio performance and scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) [P]
- [Amazon API Gateway throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html) [P]
