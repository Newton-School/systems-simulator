# 18. Data infrastructure and AI

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 5 `DataInfraType`s: `etl-pipeline`, `streaming-analytics`, `feature-store`, `memory-fabric`,
`model-serving`; plus the AI-related `llm-gateway` (integration) and `agent-orchestrator`. Vector search
indexes are chapter 09; queues and streams are chapter 13.

## 1. Batch versus streaming

|              | Batch (ETL)                             | Streaming                                      |
| ------------ | --------------------------------------- | ---------------------------------------------- |
| Unit of work | a bounded dataset                       | an unbounded flow of events                    |
| Freshness    | period of the schedule (hourly, daily)  | seconds                                        |
| Cost shape   | throughput: data size / processing rate | sustained rate x per-event cost, always on     |
| Failure      | re-run the job                          | resume from an offset; exactly-once needs care |

Batch time = data size / throughput: 500 GB at 250 MB/s is **2,000 s (33 min)**; a daily job must finish before the next run starts or it queues behind itself. [computed]
**Backfill** (reprocessing history) competes with the live pipeline for the same resources. **Idempotent** loads make re-runs safe. [D]

## 2. Windowing

Streaming aggregates group events into **windows**: [P: Apache Flink documentation]

- **Tumbling:** fixed size, no overlap; each event is in exactly one window.
- **Sliding:** fixed size, with a slide step; when the slide is smaller than the size windows overlap, so each event falls in size / slide windows (10-minute windows sliding every 5 minutes put each event in 2). [P example, K arithmetic]
- **Session:** windows that close after a gap with no events.
- **Event time vs processing time.** Event-time windows fire when the **watermark** passes the window end; by default **late** events (behind the watermark) are **dropped**, and **allowed lateness** (default 0) keeps the window open longer and can fire it again. [P]

Worked: 1,000 events/s into 5-minute tumbling windows = **300,000 events** per window, one result every 300 s. The same stream in 10-minute windows sliding every 5 minutes does about **2x the work and holds 2x the state**, and emits a result every 5 minutes. [computed]

Latency of a windowed result is at least the window length (plus watermark delay): a 60 s window cannot give a sub-minute answer. [D]

## 3. Feature stores

A feature store serves the same features for **training** and for **inference**: [S: Feast documentation]

- **Offline store** (warehouse or lake): historical features for training and batch scoring.
- **Online store:** a low-latency key-value store holding the latest feature values for real-time prediction.
- **Materialization** copies features from batch sources into the online store; freshness is limited by how often it runs, and **training/serving skew** appears when online and offline values differ. [S, K]
- **Point-in-time correctness:** a training row must only use feature values that were known at that row's timestamp, or the model leaks the future. [S: Feast documentation, point-in-time joins]

## 4. Model serving

- **Latency** = queueing + batch wait + inference time + pre/post-processing. [D]
- **Dynamic batching** groups requests to use the accelerator efficiently: throughput per replica = batch size / batch time. Batch of 8 at 40 ms gives **200 req/s**; waiting up to 10 ms to fill a batch adds up to 10 ms to the first request. Bigger batches raise throughput and latency together. [computed]
- **GPU memory** limits batch size and the number of models resident; loading a model from storage is a cold start (seconds to minutes). [S: Kwon et al., PagedAttention: KV-cache memory limits batch size]
- **Autoscaling** models is slow because replicas start slowly (chapter 14); keep warm capacity for bursts. [D]

## 5. Large-language-model serving and gateways

- **Latency of a response** = time to first token + (output tokens - 1) x time per token. 500 output tokens at 20 ms per token is about **10 s**; the first token (prefill) depends on the prompt length, the rest on the output length. A chatty prompt is slow regardless of request rate. [D]
- **Concurrency** (Little, chapter 01): 10 requests/s x 10 s = **100 concurrent streams**; capacity is bounded by accelerator memory for the key-value cache of each active sequence. [computed, K]
- **Cost** = input tokens x price_in + output tokens x price_out; output is usually priced higher. Rate limits are often in tokens per minute as well as requests per minute. [D: definition of token pricing]
- **LLM gateway:** a proxy in front of providers adding routing, caching, rate limiting, fallbacks and token accounting; it adds a hop and can cache identical prompts (chapter 10). [D]
- **Agents:** an orchestrator calls a model and tools in a loop. Sequential steps **add** their latencies (5 steps x 4 s = 20 s); parallel tool calls cost the **maximum** of the branches, which grows like H_n for n independent exponential-like calls (chapter 12). Each retry or extra step multiplies token cost. [D]
- **Semantic caching** trades hit ratio against wrong answers for near-duplicate prompts. [D]

## 6. Failure modes

- **Late data** silently dropped by a window: totals disagree with the batch result.
- **Backlog in the stream** when the processing rate falls below the arrival rate (chapter 13); lag grows without bound.
- **Training/serving skew:** online features computed differently from offline ones.
- **Cold model:** the first request after scale-out waits for the model to load.
- **Token blow-up:** long prompts or loops in an agent multiply latency and cost.
- **Provider rate limit:** requests fail with 429 at a tokens-per-minute ceiling.

## 7. Simulator parameter map

| Setting                        | Meaning                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `windowMs`                     | processing-time tumbling window length; one aggregate per window                      |
| `msPerToken`, `outputTokens`   | latency added per request = msPerToken x outputTokens                                 |
| model serving and stream nodes | queue and service time like any node; batching via the batching settings (chapter 13) |

[repo] Windowing is processing-time only; event-time windows, watermarks and late-data handling are deliberately not modelled. Token cost latency does not distinguish prefill from decode.

## 8. Testable expectations (summary)

- One aggregate per window; count per window = rate x window length.
- Token latency = per-token time x output tokens (+ fixed cost); doubling output tokens doubles the generation part.
- Concurrency of streams = rate x response time.
- A sliding window's work and state grow by size / slide over a tumbling window of the same size.
- A batch job that takes longer than its period builds a backlog.

## 9. Open items

- Not read in full: the Dataflow model paper and a model-serving batching reference; the vLLM paper is cited for the KV-cache limit only (abstract). No throughput figure for LLM serving is asserted.
- Decisions `[?]`: whether to model event-time windows and late data; whether to split first-token and per-token latency.

## Sources

- [Efficient Memory Management for LLM Serving with PagedAttention](https://arxiv.org/abs/2309.06180) [P, abstract]

- [Windows, Apache Flink](https://nightlies.apache.org/flink/flink-docs-master/docs/dev/datastream/operators/windows/) [P]
- [Feast: concepts overview](https://docs.feast.dev/getting-started/concepts/overview) [S]
