// Simulation output carries BigInt microsecond timestamps (e.g. trace phase
// records), which JSON.stringify rejects. Emit them as numbers when exactly
// representable, otherwise as decimal strings so no precision is lost.
function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== 'bigint') return value
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString()
}

export function stringifyCliJson(value: unknown): string {
  return JSON.stringify(value, bigintReplacer, 2)
}
