import directClientServerRaw from '../../../engine/__samples__/direct-client-server.json?raw'
import monolithStackRaw from '../../../engine/__samples__/traditional-single-instance-stack.json?raw'
import proxyEdgeRaw from '../../../engine/__samples__/proxy-edge.json?raw'
import l7ScaleOutRaw from '../../../engine/__samples__/horizontal-compute-scaling-l7.json?raw'
import cacheAsideRaw from '../../../engine/__samples__/basic-cache-stack.json?raw'
import readReplicaRaw from '../../../engine/__samples__/primary-read-replica.json?raw'
import serverlessColdStartRaw from '../../../engine/__samples__/serverless-cold-start.json?raw'
import keyBasedShardingRaw from '../../../engine/__samples__/key-based-sharding.json?raw'
import streamConsumerLagRaw from '../../../engine/__samples__/stream-consumer-lag.json?raw'
import dnsWeightedRoutingRaw from '../../../engine/__samples__/dns-weighted-routing.json?raw'
import circuitBreakerRaw from '../../../engine/__samples__/circuit-breaker-fail-fast.json?raw'

export type SampleDifficulty = 'starter' | 'intro' | 'intermediate' | 'advanced'

export interface SampleScenario {
  id: string
  name: string
  subtitle: string
  diagram: string
  primaryUseCase: string
  simulatorValue: string
  difficulty: SampleDifficulty
  raw: string
}

export const SAMPLE_SCENARIOS: SampleScenario[] = [
  {
    id: 'direct-client-server',
    name: 'Bare Metal Baseline',
    subtitle: 'Direct Client-Server',
    diagram: 'Client App -> API Server',
    primaryUseCase: 'Baseline network latency, connection limits, and single-instance saturation.',
    simulatorValue: 'Show how quickly one node gets overwhelmed by high RPS or concurrency.',
    difficulty: 'starter',
    raw: directClientServerRaw
  },
  {
    id: 'traditional-single-instance-stack',
    name: 'Monolith Core',
    subtitle: 'Traditional Single-Instance Stack',
    diagram: 'Client App -> API Server -> Primary DB',
    primaryUseCase: 'Trace bottlenecks between compute processing and database query time.',
    simulatorValue:
      'Slow DB service time bubbles up into API saturation and client-visible timeouts.',
    difficulty: 'starter',
    raw: monolithStackRaw
  },
  {
    id: 'proxy-edge',
    name: 'Proxy Edge Shield',
    subtitle: 'Basic Gateway / Reverse Proxy',
    diagram: 'Client App -> Reverse Proxy / WAF -> API Server',
    primaryUseCase: 'Edge security, forwarding rules, SSL termination, and timeout boundaries.',
    simulatorValue:
      'Compare the extra edge hop with proxy-side drops before traffic reaches compute.',
    difficulty: 'starter',
    raw: proxyEdgeRaw
  },
  {
    id: 'horizontal-compute-scaling-l7',
    name: 'L7 Scale-Out',
    subtitle: 'Horizontal Compute Scaling',
    diagram: 'Client App -> Load Balancer L7 -> API A / API B -> Primary DB',
    primaryUseCase: 'Round-robin routing and high availability across stateless compute.',
    simulatorValue:
      'Fail one API server and watch the L7 load balancer keep traffic on the healthy node.',
    difficulty: 'starter',
    raw: l7ScaleOutRaw
  },
  {
    id: 'basic-cache-stack',
    name: 'Cache-Aside Read Path',
    subtitle: 'Simple State Separation',
    diagram: 'Client App -> API Server -> Redis Cache / Primary DB',
    primaryUseCase: 'Cache hit and miss ratios, read offload, and data retrieval latency.',
    simulatorValue:
      'A 90% hit mix keeps DB load low; a miss-heavy mix behaves like a cache stampede.',
    difficulty: 'starter',
    raw: cacheAsideRaw
  },
  {
    id: 'primary-read-replica',
    name: 'Replica Read Split',
    subtitle: 'Storage Read Scaling',
    diagram: 'Client App -> API Server -> Primary DB / Read Replica',
    primaryUseCase: 'Read-heavy apps where writes are rare and reads dominate traffic.',
    simulatorValue:
      'Separate read and write paths to see replica saturation without hurting writes.',
    difficulty: 'starter',
    raw: readReplicaRaw
  },
  {
    id: 'serverless-cold-start',
    name: 'Serverless Cold Start',
    subtitle: 'Serverless Invocation',
    diagram: 'Client App -> Checkout Function',
    primaryUseCase:
      'A bursty source wakes an idle serverless function, showing the first cold-start spike and later warm requests.',
    simulatorValue:
      'Run it once, then switch to Latency. The first burst after idle should spike. Increase base RPS until max concurrency is hit and watch rejections appear.',
    difficulty: 'intro',
    raw: serverlessColdStartRaw
  },
  {
    id: 'key-based-sharding',
    name: 'Key-Based Sharding',
    subtitle: 'Hash-Routed Storage',
    diagram: 'Client -> Shard Router -> Shard A / B / C',
    primaryUseCase:
      'Requests with the same shard key always land on the same shard while different keys spread across the ring.',
    simulatorValue:
      'Run it, then inspect the shard nodes. The same shardKey keeps arriving at the same shard across reruns with the same seed.',
    difficulty: 'intermediate',
    raw: keyBasedShardingRaw
  },
  {
    id: 'stream-consumer-lag',
    name: 'Stream Consumer Lag',
    subtitle: 'Streaming Backlog',
    diagram: 'Producer -> Kafka Topic',
    primaryUseCase:
      'A producer publishes faster than the stream can drain, causing visible lag growth inside the broker.',
    simulatorValue:
      'Switch to Throughput, select the stream, and inspect its lag summary. Final lag should stay above zero while producer RPS exceeds consumer capacity.',
    difficulty: 'intermediate',
    raw: streamConsumerLagRaw
  },
  {
    id: 'dns-weighted-routing',
    name: 'DNS Weighted Routing',
    subtitle: 'Weighted Resolution',
    diagram: 'Client -> Resolver -> Stable API / Canary API',
    primaryUseCase:
      'A resolver returns weighted answers and caches lookups, making 80/20 splits and TTL effects visible.',
    simulatorValue:
      'Run it, then inspect the two API targets. The weighted policy should send roughly 80% of traffic to stable and 20% to canary while repeated lookups hit the DNS cache.',
    difficulty: 'intermediate',
    raw: dnsWeightedRoutingRaw
  },
  {
    id: 'circuit-breaker-fail-fast',
    name: 'Circuit Breaker Fail-Fast',
    subtitle: 'Resilient Sidecar',
    diagram: 'Client -> Sidecar -> Payment Service',
    primaryUseCase:
      'A sidecar trips open after repeated downstream failures, then rejects quickly until probe traffic is allowed again.',
    simulatorValue:
      'Switch to Errors and inspect the sidecar. Rejections should move from downstream node errors to fail-fast breaker rejections after the breaker opens.',
    difficulty: 'advanced',
    raw: circuitBreakerRaw
  }
]
