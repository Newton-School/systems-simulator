/**
 * Deterministic serialization and hashing shared across the analysis layer.
 *
 * `stableSerialize` produces a canonical, key-sorted string for any JSON-like
 * value so that two structurally-equal values always serialize identically.
 * `stableHashToken` is a short FNV-1a token used for host-safe test ids.
 * `canonicalChecksum` is a wider, multi-lane integrity checksum used to make
 * grading artifacts tamper-evident and reproducible (see evaluationEnvelope.ts).
 *
 * These are integrity/reproducibility primitives, not cryptographic signatures:
 * they detect accidental drift and casual tampering, not a motivated adversary.
 * Adversarial tamper-proofing would require a server-side signature.
 */

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

export function stableHashToken(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}

export function hostSafeToken(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${slug || 'item'}-${stableHashToken(value)}`
}

/**
 * A 128-bit content checksum built from four independent FNV-1a lanes, each
 * seeded differently and salted with the input length. Four 32-bit lanes give a
 * 32-character hex digest with a collision space far wider than the single-lane
 * `stableHashToken`, which is what makes it suitable for tamper-evidence over a
 * whole evaluation envelope rather than a single id.
 */
export function canonicalChecksum(value: unknown): string {
  const serialized = stableSerialize(value)
  const seeds = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0x9e3779b1]
  const lanes = seeds.map((seed) => seed >>> 0)

  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index)
    for (let lane = 0; lane < lanes.length; lane += 1) {
      lanes[lane] ^= code + lane * 0x1000193
      lanes[lane] = Math.imul(lanes[lane], 0x01000193)
    }
  }

  // Fold the length in so that padding-style collisions are harder to construct.
  for (let lane = 0; lane < lanes.length; lane += 1) {
    lanes[lane] ^= serialized.length
    lanes[lane] = Math.imul(lanes[lane], 0x01000193)
  }

  return lanes.map((lane) => (lane >>> 0).toString(16).padStart(8, '0')).join('')
}
