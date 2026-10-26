# 21. DNS and certificates

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 3 `DnsType`s: `dns-authoritative-server`, `internal-dns`, `certificate-distro`. Related: global traffic
management and geo latency (chapter 07), TLS handshake round trips (chapter 08), certificate authority and key
management (chapter 15).

## 1. Name resolution

A client asks a **recursive resolver**, which walks root, top-level domain and the **authoritative** server for the
zone, and caches the answer for its **TTL**. [S: RFC 1034 recursive resolution; RFC 2181 for the TTL]

- A cold lookup takes about **3 round trips** (root, TLD, authoritative) plus the client's own hop to the resolver; a cached lookup costs only the hop to the resolver (or nothing, from the operating-system cache). [D: root, TLD and authoritative queries are three sequential lookups; real resolvers usually have the root and TLD name servers cached, so the typical cold cost is one round trip to the authoritative server]
- **TTL** is an unsigned 32-bit number of seconds, valid range **0 to 2^31 - 1**; it is a **maximum**, not a promise: "The TTL specifies a maximum time to live, not a mandatory time to live", so implementations may cap it. All records in one record set must carry the same TTL. [P: RFC 2181]
- **Negative answers** (name does not exist) are cached too, using the zone's SOA minimum. [P: RFC 2308 negative caching, using the SOA MINIMUM]

**Cache miss ratio.** For one resolver cache and requests for a name arriving at rate lambda (Poisson), each time the cached answer expires the next request misses and refills it for TTL seconds; a cycle holds on average 1 + lambda x TTL requests, so

**miss ratio = 1 / (1 + lambda x TTL)** [derived]

Worked: lambda = 1/s, TTL = 30 s: 1/31 = **3.2%**. A rarely requested name, lambda = 0.01/s, TTL = 30 s: 1/1.3 = **77%**. Expected resolution latency = miss ratio x cold-lookup time. [computed]

## 2. TTL and failover

DNS-based failover works only as fast as clients' caches expire. [D]

- After the authoritative answer changes, each cache keeps the old answer for up to TTL: the **worst case is TTL**, the mean over caches is about TTL / 2.
- Total time to move traffic after a failure = **detection time** (health-check interval x consecutive failures) + **TTL propagation**. A 10 s check with 3 failures and a 60 s TTL: 30 s to detect, then up to 60 s (mean 30 s) for caches to drop the old answer: up to **90 s** of traffic to a dead endpoint, **60 s** on average per client. [computed]
- Lowering the TTL ahead of a planned change shortens it; very low TTLs raise load on the authoritative servers: queries per second to the authoritative server is roughly (resolvers x names) / TTL. [D]
- Some resolvers and clients ignore low TTLs, so any failover design must tolerate a longer tail. [S: widely reported; no measurement cited, so treat as a design caution rather than a figure]

## 3. Routing policies

Route 53, as a reference, offers these policies: **simple** (one resource), **failover** (active-passive on health), **geolocation** (by user location), **geoproximity** (by resource location with a bias), **latency** (the Region with the best latency), **IP-based** (by client address range), **multivalue answer** (up to eight healthy records chosen at random) and **weighted** (proportions you set). [P: Route 53 developer guide]

- **Weighted:** share of resolutions for a record = its weight / sum of weights. Because answers are cached, the share of **traffic** follows the share of **resolver cache fills**, so a few large resolvers can skew it. [D]
- **Failover:** serve the primary while its health check passes, else the secondary. [P]
- **Latency / geolocation:** choose the target by measured latency or by user location, an input of the client's resolver address unless EDNS client subnet is used. [S: Route 53 developer guide]

## 4. Certificates

- A certificate binds a name to a public key, signed by a certificate authority; clients check **name, validity period and chain** (and revocation). [D: definition]
- **Lifetime:** Let's Encrypt certificates last **90 days**, renewed about every **60 days**; short-lived certificates last **6 days**, renewed every **3 days**. Lifetimes cannot be adjusted. [P: Let's Encrypt FAQ]
- **Renewal margin:** the window between the renewal point and expiry is the time automation has to recover from a failure: 30 days for the 90-day default, 3 days for the 6-day certificate. If renewal fails for longer than the margin, **every new TLS connection fails at expiry**. [computed]
- **Distribution:** a renewed certificate must reach every terminator (load balancers, CDN edges, gateways). Time to fully deploy = nodes / rollout parallelism x time per node; until then some nodes still serve the old one. [D]
- **Revocation:** CRLs and OCSP add a lookup unless the server staples the response. [D: definition]

## 5. Failure modes

- **Stale cache after a change:** clients reach the old address until TTLs run out.
- **Authoritative server down:** uncached names fail to resolve; cached names keep working until their TTL ends (so outage impact lags by up to TTL).
- **Resolver overload or poisoning** (see chapter 15).
- **Expired certificate:** a hard, simultaneous outage for all new connections; monitoring expiry dates is a standard control.
- **Partial certificate rollout:** some endpoints serve the new certificate and some the old; clients that pin or compare see mismatches.

## 6. Simulator parameter map

| Setting                                             | Meaning                                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dnsRoutingPolicy`                                  | `simple`, `weighted`, `failover`, `latency-based` or `geolocation` on `internal-dns` and `global-traffic-manager`                                          |
| `dnsCacheTtlSeconds` (30)                           | how long an answer is cached per host or request type                                                                                                      |
| `dnsResolvers`                                      | number of resolvers that each cache an answer for the TTL: a failover reaches a resolver only when its entry expires (unset: every request resolves fresh) |
| `certificateValidUntilMs`, `certificateRenewedAtMs` | on `certificate-distro`: when the certificate expires and when a replacement is in place                                                                   |
| `dnsGeoTargets`                                     | origin to target mapping for geolocation                                                                                                                   |
| edge `weight`                                       | weight of a weighted answer; an unset or non-positive weight counts as 1                                                                                   |
| `regionLatencyMs`                                   | fixed extra latency per request on a CDN, traffic manager or edge router (the distance to the serving region)                                              |

[repo] `certificate-distro` models expiry: from `certificateValidUntilMs` every request through it fails with `certificate_expired`, until `certificateRenewedAtMs` if one is set (the gap is the margin automation has to renew in). Renewal automation and partial rollout are not modelled.

## 7. Testable expectations (summary)

- Weighted resolution shares equal weight / sum of weights within sampling error; an unset weight counts as 1.
- A cached answer is reused for the TTL and re-resolved afterwards: resolutions per name over a run = run time / TTL.
- Cache miss ratio follows 1 / (1 + lambda x TTL).
- After a primary fails, failover moves traffic only once detection and TTL have elapsed.
- Geolocation sends each origin to its mapped target; an unmapped origin goes to the first answer by name (a default record), and the import warns about any origin with no target (decision G11).
- A certificate past its expiry fails new connections; renewal margin = lifetime - renewal point.

## 8. Open items

- Read directly: RFC 2308 (negative caching) and RFC 2181 (TTL). RFC 1034 and 1035, the Route 53 pages and the Let's Encrypt FAQ are cited as before; no measurement of resolvers ignoring TTLs is asserted.
- Decided and implemented: certificate expiry (`certificateValidUntilMs`, `certificateRenewedAtMs`); rollout across terminators is not modelled.

## Sources

- [RFC 2308: negative caching of DNS queries](https://www.rfc-editor.org/rfc/rfc2308.txt) [P]

- [RFC 2181: Clarifications to the DNS specification](https://datatracker.ietf.org/doc/html/rfc2181) [P]
- [Choosing a routing policy, Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html) [P]
- [Let's Encrypt FAQ](https://letsencrypt.org/docs/faq/) [P]
