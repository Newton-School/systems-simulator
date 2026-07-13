import directClientServerRaw from '../../../engine/__samples__/direct-client-server.json?raw'
import monolithStackRaw from '../../../engine/__samples__/traditional-single-instance-stack.json?raw'
import proxyEdgeRaw from '../../../engine/__samples__/proxy-edge.json?raw'
import l7ScaleOutRaw from '../../../engine/__samples__/horizontal-compute-scaling-l7.json?raw'
import cacheAsideRaw from '../../../engine/__samples__/basic-cache-stack.json?raw'
import readReplicaRaw from '../../../engine/__samples__/primary-read-replica.json?raw'

export interface SampleScenario {
  id: string
  name: string
  subtitle: string
  diagram: string
  primaryUseCase: string
  simulatorValue: string
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
    raw: readReplicaRaw
  }
]
