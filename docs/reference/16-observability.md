# 16. Observability

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 9 `ObservabilityType`s: `centralized-logging`, `distributed-tracing`, `metrics-store`, `alerting-hook`,
`dashboard`, `rum-monitoring`, `health-check-manager`, `safety-observability-mesh`, `profiling-service`. The
simulator's own output metrics are defined in chapter 27; health-check detection delay in chapters 02 and 07.

## 1. Logs, metrics, traces

| Signal       | What it is                                         | Cost driver                               | Good for               |
| ------------ | -------------------------------------------------- | ----------------------------------------- | ---------------------- |
| **Metrics**  | numeric time series (counters, gauges, histograms) | cardinality (distinct label combinations) | alerting, trends, SLOs |
| **Logs**     | discrete events with text                          | volume (bytes per event x events)         | detail about one event |
| **Traces**   | the path of one request across services as spans   | spans per request x request rate          | where time went        |
| **Profiles** | where CPU or memory goes inside a process          | sampling frequency                        | optimising code        |

[D: definition] Observability is the ability to ask new questions of a running system from its outputs; monitoring is watching known failure signals.

## 2. The four golden signals

Google's SRE book names four: [P: SRE book, Monitoring Distributed Systems]

- **Latency:** time to serve a request; track successful and failed requests **separately**, since a fast error can flatter an average.
- **Traffic:** demand, for example requests per second.
- **Errors:** rate of failed requests, explicit, implicit (wrong content with a success code) or by policy (slower than the commitment).
- **Saturation:** how full the most constrained resource is; systems degrade before 100%.

Averages hide tails: a 100 ms mean can coexist with requests taking 5 s; record **histograms** (counts per bucket, roughly exponential boundaries) and read percentiles. [P]

## 3. Percentiles from histograms

A histogram stores counts per bucket. `histogram_quantile` assumes observations are spread evenly inside the bucket containing the quantile and **interpolates linearly**; the error is bounded by the **width of that bucket**. With buckets at 200 ms and 300 ms, a true p95 of 220 ms can only be placed in that 100 ms range (the page's example estimated about 295 ms). [P: Prometheus histograms and summaries]

- **Never average percentiles** across instances: the result is statistically meaningless. Sum bucket counts across instances (same boundaries), then compute the quantile. [P]
- Summaries compute quantiles in the client: cheap to query, but not aggregatable. [P]

## 4. SLIs, SLOs, error budgets and burn rate

- **SLI:** a measured ratio, for example good requests / total requests. **SLO:** the target for it over a window, for example 99.9% over 30 days. The **error budget** is 1 - SLO. [D: definition from the SRE book terms]
- Budget in time: 30 days = 43,200 min, so 99% allows **432 min (7.2 h)**; 99.9% allows **43.2 min**; 99.99% allows **4.32 min**. [computed]
- **Burn rate** is how fast the budget is consumed relative to the SLO: 1 means the whole budget lasts exactly the window. Budget consumed = burn rate x alert window / period. Time to exhaustion = period / burn rate: burn rate 2 gives 15 days, 10 gives 3 days, 1,000 gives 43 minutes. [P: Google SRE workbook, Alerting on SLOs]
- **Error rate that burns at rate B** = B x (1 - SLO). For a 99.9% SLO, burn rate 14.4 is an error rate of **1.44%**. [P]
- **Multiwindow, multi-burn-rate alerts** (99.9% SLO, 30 days): [P]

| Severity | Long window | Short window | Burn rate | Budget consumed |
| -------- | ----------- | ------------ | --------- | --------------- |
| Page     | 1 hour      | 5 minutes    | 14.4      | 2%              |
| Page     | 6 hours     | 30 minutes   | 6         | 5%              |
| Ticket   | 3 days      | 6 hours      | 1         | 10%             |

The alert fires only when **both** windows exceed the threshold: the long window gives significance, the short window makes the alert reset quickly after the problem ends. [P]

Alerting philosophy: page on **symptoms** (users affected), use causes for debugging; every page must be urgent, actionable and need human judgement. [P: SRE book]

## 5. Sampling, volume and cost

- **Head sampling** decides at the root span, cheaply (dropped traces create no spans) but blind to the outcome; **tail sampling** decides after the trace completes, so it can keep every error and slow trace, but must buffer all spans in a collector. Sampling by trace id lets every service reach the same decision without coordination. [S: Uptrace, OpenSearch, Datadog guides]
- Dapper kept overhead low and deployment ubiquitous by sampling and by instrumenting a small number of common libraries. [P: Dapper paper abstract]
- **Capture probability.** With head sampling rate p, the chance of capturing at least one of k occurrences of a rare event is 1 - (1 - p)^k. At p = 1%, seeing it with 99% probability needs k >= **459** occurrences. [computed]
- **Volume.** Log bytes/day = events/s x bytes x 86,400: 5,000 req/s x 1 KB is 5 MB/s = **432 GB/day**. Trace storage = request rate x spans per trace x bytes per span x sampling rate. [computed]
- **Cardinality.** Metric cost grows with the product of label value counts; a per-user label turns a few series into millions. [D]
- **Observer effect.** Synchronous logging or export adds latency to the request; asynchronous export through a bounded buffer drops events under overload instead, and the application is unaffected. [D]

## 6. Health checks and real-user monitoring

- A health check's **detection time** is interval x consecutive failures needed (chapter 02): 10 s x 3 = up to 30 s of traffic to a dead target. [D]
- **RUM** measures what users experience in the browser (page load, errors) and is the only signal that includes the last mile; it is sampled and sent asynchronously. [D]
- **Continuous profiling** samples stacks at a fixed rate, so its CPU overhead is a function of that rate and is a deliberate trade for always-on visibility; no overhead figure is asserted here. [D]

## 7. Failure modes

- **Telemetry pipeline overload:** collectors drop events; a dashboard goes blank or flat exactly during the incident.
- **Averaged percentiles** or too-wide buckets hide a tail problem.
- **Alert fatigue:** thresholds on causes, not symptoms.
- **Cardinality explosion:** the metrics store runs out of memory or the bill spikes.
- **Blind spots:** sampling that drops the rare error you care about.

## 8. Simulator parameter map

| Setting                    | Meaning                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `telemetryAsyncIngest`     | exporter sends through a bounded buffer; drops instead of rejecting  |
| `telemetrySampleRate`      | head sampling: only this fraction of events is exported              |
| `telemetryIngestRps`       | rolling 1 s ingest ceiling; beyond it events are dropped             |
| `telemetryDropped` counter | events lost; completes the export branch so user requests never fail |
| global `traceSampleRate`   | fraction of requests traced in the output                            |

[repo] Dropped telemetry never appears as a failed user request, which matches fire-and-forget exporters.

## 9. Testable expectations (summary)

- With sampling rate p, exported events = p x events within sampling error; dropped = events past the ingest ceiling.
- Telemetry overload never raises the application's error rate or latency (fire-and-forget).
- Burn rate = observed error rate / (1 - SLO); time to exhaustion = window / burn rate.
- A percentile computed from bucketed counts is within the bucket width of the true value.
- Probability of capturing a rare event at sampling rate p over k occurrences is 1 - (1 - p)^k.
- Health-check detection delay is interval x failures.

## 10. Open items

- Read directly: the SRE book and workbook pages, Prometheus histogram guidance and the Dapper abstract. The OpenTelemetry sampling specification is cited through vendor guides; no overhead or sampling-rate figure from Dapper is asserted.
- Decided and implemented: the output carries `sloStatus[]` (error rate, budget, burn rate, within budget) for every node with an SLO, and the rubric can use `slo.maxBurnRate` and `slo.budgetsExceeded.count`.

## Sources

- [Monitoring Distributed Systems, Google SRE book](https://sre.google/sre-book/monitoring-distributed-systems/) [P]
- [Alerting on SLOs, Google SRE workbook](https://sre.google/workbook/alerting-on-slos/) [P]
- [Histograms and summaries, Prometheus](https://prometheus.io/docs/practices/histograms/) [P]
- [Dapper, a large-scale distributed systems tracing infrastructure](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/) [P]
- [OpenTelemetry sampling: head-based and tail-based (Uptrace)](https://uptrace.dev/opentelemetry/sampling.html) [S]
- [Sampling strategies (OpenSearch)](https://observability.opensearch.org/docs/send-data/opentelemetry/sampling/) [S]
