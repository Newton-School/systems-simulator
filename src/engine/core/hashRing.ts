/**
 * Consistent-hash ring shared by routing strategies that must keep the same key
 * on the same target as the pool changes (LB session affinity, key/shard routing).
 * Kept as a dependency-free leaf module so both `routing.ts` and trait modules can
 * import it without creating an import cycle.
 */

/** Virtual points per target on the ring (smooths key distribution). */
export const HASH_RING_VNODES = 64

/**
 * Deterministic 32-bit hash of a string: FNV-1a followed by a MurmurHash3
 * avalanche finalizer. The finalizer is important here — plain FNV-1a maps
 * near-identical sequential keys (`key-0`, `key-1`, … / `user-1`, `user-2`, …)
 * into a narrow band, which would pile them onto one arc of the ring. The mix
 * spreads such keys across the whole 32-bit space so the ring distributes evenly.
 */
export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // MurmurHash3 fmix32 avalanche.
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

/**
 * Maps `key` to one of `routes` via a consistent-hash ring of virtual points.
 * Adding or removing one route reassigns only that route's arc of the ring
 * (~1/N of keys), unlike `hash(key) % n` which remaps almost everything. The ring
 * is rebuilt from the current route set on each call — cheap for the small pools
 * here and correct as membership changes. Generic over anything with a
 * `targetNodeId` so both routing and trait callers can use it.
 */
export function pickOnHashRing<T extends { targetNodeId: string }>(routes: T[], key: string): T {
  if (routes.length === 1) return routes[0]!
  const points: { hash: number; route: T }[] = []
  for (const route of routes) {
    for (let v = 0; v < HASH_RING_VNODES; v++) {
      points.push({ hash: hashString(`${route.targetNodeId}#${v}`), route })
    }
  }
  points.sort((a, b) => a.hash - b.hash)
  const target = hashString(key)
  // First point clockwise from the key's hash; wrap to the first point.
  for (const point of points) {
    if (point.hash >= target) return point.route
  }
  return points[0]!.route
}
