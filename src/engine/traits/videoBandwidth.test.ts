import { describe, expect, it } from 'vitest'
import { videoRoomBandwidth } from './videoBandwidth'

describe('videoRoomBandwidth (chapter 19 section 5)', () => {
  it('an SFU forwards every stream to every other participant', () => {
    const b = videoRoomBandwidth('sfu', 50, 1.5)
    expect(b.egressMbps).toBeCloseTo(50 * 49 * 1.5, 9) // 3,675
    expect(b.ingressMbps).toBeCloseTo(75, 9)
    expect(b.perParticipantUploadMbps).toBe(1.5)
  })

  it('an MCU sends one mixed stream per participant', () => {
    expect(videoRoomBandwidth('mcu', 50, 1.5).egressMbps).toBeCloseTo(75, 9)
  })

  it('a mesh makes each participant upload N - 1 streams', () => {
    expect(videoRoomBandwidth('mesh', 5, 1.5).perParticipantUploadMbps).toBeCloseTo(6, 9)
  })
})
