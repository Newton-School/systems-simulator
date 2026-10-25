# 23. Capacity planning and cost

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

Sizing a system for load and failure, and pricing the result. Builds on chapter 01 (utilization and queueing, the
QuickCart sizing), chapter 06 (instances and scaling limits), chapter 14 (autoscaling) and chapter 22 (survivor load).

## 1. Utilization targets and headroom

Latency rises sharply as utilization approaches 1 (chapter 01), so a system is sized to run **well below** full:
typical targets are 60% to 80% busy at the planning peak, lower for latency-sensitive tiers. [K: a planning convention, not a standard; the reason is the hockey stick of chapter 01]

- Servers needed = ceil( peak rate / (per-server rate x target utilization) ). QuickCart: 1,000,000 req/s at 100,000 per server and a 0.8 target needs **13** servers (12 give 83.3%, 13 give 76.9%). [computed, chapter 01]
- **Headroom** is the unused share, 1 - utilization; it is the price of absorbing bursts, failures and forecast error. [D]

## 2. N+1 and N+2

Sizing so the fleet still meets its target after losing k servers:

normal utilization <= target x (N - k) / N

Worked: 12 servers, target 80% after one failure: normal utilization <= 0.8 x 11/12 = **73.3%**; after losing it, the 11 survivors run at 80%. For k = 2 on 12 servers: 0.8 x 10/12 = **66.7%**. Losing one of 3 zones: survivors run at 1.5x, so a 3-zone fleet should run at no more than 2/3 of the target to survive a zone loss. [computed] The Google SRE book recommends testing to failure and planning **N+2** where an update or a failure can overlap. [P: SRE book, Addressing Cascading Failures]

## 3. Instance sizing and cost per request

- **Capacity of one instance** = servers x (1 / service time) (workers per vCPU and perf factor from chapter 06), times the utilization target.
- **Cost per request** = price per hour / (requests per hour per instance).

Worked with the simulator's catalogue prices: an `m5.large` (2 vCPU, $0.096/h) running 100 ms requests serves 2 / 0.1 s = 20 req/s at full load, **14 req/s at 70%**: 50,400 requests per hour, so **$0.096 / 50,400 = $1.9 per million requests**. [computed from the catalogue]

- Within one instance family price grows about linearly with size (`m5.xlarge` is $0.192 for 4 vCPU), so larger instances do not make a request cheaper; they cut the number of nodes (and per-node overhead) and raise the blast radius of one failure. [S: AWS list prices as aggregated by DoiT and Holori, us-east-1: m5.large $0.096, m5.xlarge $0.192 per hour; catalogue prices match]
- **Scaling limits** (Amdahl and USL, chapter 06) mean that past some size extra vCPUs add little; the cheapest design may use more, smaller instances. [D]

## 4. Pricing models

| Model                   | Real discount vs on-demand                          | Commitment and risk                                                   | Simulator multiplier |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------- | -------------------- |
| On-demand               | 0                                                   | none                                                                  | 1.0                  |
| Reserved / savings plan | up to about 66% to 72% for a one or three year term | pay whether used or not                                               | 0.6                  |
| Spot                    | up to about 90%                                     | the provider can reclaim the instance with about a two-minute warning | 0.3                  |

[S: third-party summaries of AWS pricing; the AWS pricing pages themselves were not fetched, so treat the percentages as indicative]

- **Reserved break-even:** you pay the reserved rate for every hour, so it beats on-demand when the instance would otherwise run more than (reserved multiplier) of the hours: at a 0.6 multiplier, above **60% utilization of the hours**. [computed]
- **Spot** suits stateless, fault-tolerant and batch work; the effective cost is price x (1 + overhead of interruptions and retried work). A workload that loses 10% of its work to interruptions at 0.3 pays 0.33 of on-demand. [computed]
- **Autoscaling** saves the idle share of a peaky load: a service that needs 10 instances for 4 hours a day and 3 the rest averages (10 x 4 + 3 x 20) / 24 = **4.2** instances, not 10. [computed]

## 5. Forecasting and when to buy more

With demand growing by a fraction g per period and current utilization u, the time until a target utilization u\* is reached is

**t = ln(u\* / u) / ln(1 + g)** [derived]

Worked: 50% utilization today, 10% monthly growth, 80% target: ln(1.6) / ln(1.1) = **4.9 months**; to reach 100%: ln(2) / ln(1.1) = **7.3 months**. Capacity must be ordered before this date, allowing for provisioning time (chapter 14: minutes for a node, weeks for hardware). [computed]

- **Load tests** find the real per-server limit; planning from a spreadsheet of CPU alone misses memory, connections, locks and downstream limits. [K: practice]
- Plan for the **peak**, not the mean: the diurnal ratio of peak to mean (chapter 05) sets the idle share of a statically sized fleet. [D]

## 6. Where the money goes

| Line             | Driver                                                          |
| ---------------- | --------------------------------------------------------------- |
| Compute          | instance hours x price x pricing multiplier                     |
| Storage          | GB-months, requests, IOPS provisioned (chapter 09)              |
| Network          | egress GB, cross-zone transfer, load balancer hours             |
| Managed services | per request or per hour (consumption pricing)                   |
| Observability    | log and trace volume (chapter 16: 5 MB/s of logs is 432 GB/day) |

Cost is a function of the design, so it can be a constraint in a question: "meet the SLO under $X per hour". [D]

## 7. Simulator parameter map

| Setting                                   | Meaning                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `resources.instanceType`, `instanceCount` | what is bought                                                                  |
| `resources.pricingModel`                  | `on-demand` (1.0), `reserved` (0.6), `spot` (0.3)                               |
| total cost                                | sum of price per hour x multiplier x instance count over priced nodes, USD/hour |
| volume nodes                              | an estimate from throughput and bytes until a run supplies measured data        |
| budget                                    | a cap on cost used for grading                                                  |

[repo] A node with no instance model is unpriced and contributes $0. The simulator's reserved and spot multipliers (0.6 and 0.3, "about 40% and 70% off") are more conservative than the real maximum discounts.

## 8. Testable expectations (summary)

- Total cost = sum over nodes of price x multiplier x count; doubling the count doubles the cost; reserved = 0.6x and spot = 0.3x of on-demand.
- Servers needed follows ceil(peak / (capacity x target)); after losing k of N servers the survivors' utilization is rho x N / (N - k).
- A fleet sized only for the mean load fails the peak; a fleet sized with N+1 headroom survives one failure at or under the target.
- Cost per request falls as utilization rises (until latency degrades) and is the same across sizes in a family at equal utilization.
- Scaling out raises cost linearly while capacity grows sub-linearly past the USL peak.

## 9. Open items

- Read directly: the AWS EC2 pricing page (Savings Plans up to 72%, Spot up to 90%, chapter 06). List prices come from third-party aggregators; the Well-Architected cost pillar and the SRE capacity chapter are not cited.
- Decisions `[?]`: whether the pricing multipliers should follow real discounts; whether to model egress and cross-zone transfer cost.

## Sources

- [Addressing Cascading Failures, Google SRE book](https://sre.google/sre-book/addressing-cascading-failures/) [P]
- Instance prices: the simulator's own catalogue (`src/engine/catalog/instanceCatalog.ts`) [repo]
- Spot and reserved discount summaries: third-party AWS pricing guides, listed in the search results for this chapter [S, to be replaced by AWS pages]
