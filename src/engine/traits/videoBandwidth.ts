import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const VIDEO_BANDWIDTH_COMPONENT_TYPES = [
  'sfu-mcu',
  'webrtc-mesh'
] as const satisfies readonly ComponentType[]

const REPORTED_KEY = 'video.bandwidthReported'

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Per-participant bandwidth of a video room (chapter 19 section 5). With `participants` N each publishing
 * `bitrateMbps` b:
 *   - an SFU forwards every stream to every other participant: ingress N x b, egress N x (N - 1) x b;
 *   - an MCU mixes into one stream per participant: ingress N x b, egress N x b;
 *   - a mesh has no server relay: each participant uploads (N - 1) x b and downloads (N - 1) x b.
 * `mode` picks one (`sfu` by default for an `sfu-mcu` node, `mesh` for `webrtc-mesh`). The totals are reported once
 * as `ingressMbps`, `egressMbps` and `perParticipantUploadMbps`; with `bandwidthLimitMbps` set, a request is refused
 * (`bandwidth_exceeded`) with the probability that the egress exceeds the limit, so a saturated link sheds load.
 */
export function videoRoomBandwidth(
  mode: 'sfu' | 'mcu' | 'mesh',
  participants: number,
  bitrateMbps: number
): { ingressMbps: number; egressMbps: number; perParticipantUploadMbps: number } {
  const n = Math.floor(participants)
  switch (mode) {
    case 'mesh':
      return {
        ingressMbps: n * (n - 1) * bitrateMbps,
        egressMbps: n * (n - 1) * bitrateMbps,
        perParticipantUploadMbps: (n - 1) * bitrateMbps
      }
    case 'mcu':
      return {
        ingressMbps: n * bitrateMbps,
        egressMbps: n * bitrateMbps,
        perParticipantUploadMbps: bitrateMbps
      }
    default:
      return {
        ingressMbps: n * bitrateMbps,
        egressMbps: n * (n - 1) * bitrateMbps,
        perParticipantUploadMbps: bitrateMbps
      }
  }
}

export const videoBandwidthTrait: NodeBehaviourTrait = {
  name: 'realtime.video-bandwidth',
  beforeArrival: ({ node, state, random }) => {
    const participants = positive(node.config?.['participants'])
    const bitrate = positive(node.config?.['bitrateMbps'])
    if (participants === null || bitrate === null) return { action: 'continue' }
    const configured = node.config?.['videoMode']
    const mode =
      configured === 'sfu' || configured === 'mcu' || configured === 'mesh'
        ? configured
        : node.type === 'webrtc-mesh'
          ? 'mesh'
          : 'sfu'
    const bandwidth = videoRoomBandwidth(mode, participants, bitrate)

    const limit = positive(node.config?.['bandwidthLimitMbps'])
    if (
      limit !== null &&
      bandwidth.egressMbps > limit &&
      (random?.() ?? 0) >= limit / bandwidth.egressMbps
    ) {
      return {
        action: 'rejected',
        reason: 'bandwidth_exceeded',
        payload: { metricCounters: { bandwidthRejects: 1 } }
      }
    }

    // The room's bandwidth is a level, not a per-request amount: report it once.
    if (state?.get<boolean>(REPORTED_KEY)) return { action: 'continue' }
    state?.set(REPORTED_KEY, true)
    return {
      action: 'continue',
      payload: {
        videoMode: mode,
        metricCounters: {
          ingressMbps: bandwidth.ingressMbps,
          egressMbps: bandwidth.egressMbps,
          perParticipantUploadMbps: bandwidth.perParticipantUploadMbps
        }
      }
    }
  }
}

export const videoBandwidthCapabilityModule: NodeCapabilityModule = {
  name: 'realtime.video-bandwidth',
  appliesTo: VIDEO_BANDWIDTH_COMPONENT_TYPES,
  hooks: videoBandwidthTrait,
  config: {
    sections: [
      {
        id: 'video-bandwidth',
        title: 'Room bandwidth',
        note: 'Reports the ingress and egress of a video room from the participant count and bitrate: an SFU forwards N x (N - 1) streams, an MCU N, a mesh makes every participant upload N - 1.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.participants',
            type: 'input',
            inputType: 'number',
            label: 'Participants',
            min: 1,
            altitude: 'primary',
            why: 'People in the room, each publishing one stream.'
          },
          {
            path: 'sim.bitrateMbps',
            type: 'input',
            inputType: 'number',
            label: 'Stream bitrate',
            unit: 'Mbps',
            min: 0,
            altitude: 'primary',
            why: 'Bitrate of one published stream.'
          },
          {
            path: 'sim.videoMode',
            type: 'select',
            label: 'Topology',
            options: ['sfu', 'mcu', 'mesh'],
            altitude: 'advanced',
            why: 'How streams reach the other participants. Default is sfu for an SFU/MCU node and mesh for a mesh node.'
          },
          {
            path: 'sim.bandwidthLimitMbps',
            type: 'input',
            inputType: 'number',
            label: 'Egress limit',
            unit: 'Mbps',
            min: 0,
            altitude: 'advanced',
            why: 'Egress the link can carry; requests are refused with the probability that demand exceeds it.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['ingressMbps', 'egressMbps', 'perParticipantUploadMbps', 'bandwidthRejects'],
    rejectionReasons: ['bandwidth_exceeded']
  },
  honesty: {
    simulates: [
      'the steady-state bandwidth of a room for SFU, MCU and mesh, and load shedding past a limit'
    ],
    notModeled: ['simulcast layers, congestion control, or per-participant network conditions']
  }
}
