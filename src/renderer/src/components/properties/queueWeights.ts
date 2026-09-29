/** One editable row of the wfq flow-weights editor; `weight` stays a string while typed. */
export interface WeightRow {
  key: number
  type: string
  weight: string
}

let nextRowKey = 0

export function newRowKey(): number {
  return nextRowKey++
}

export function rowsFromWeights(weights: Record<string, number> | undefined): WeightRow[] {
  return Object.entries(weights ?? {}).map(([type, weight]) => ({
    key: newRowKey(),
    type,
    weight: String(weight)
  }))
}

export function parseWeight(raw: string): number | null {
  const value = Number(raw)
  return raw.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null
}

/** Valid rows only (named type, positive weight); a repeated type keeps its last weight. */
export function weightsFromRows(rows: readonly WeightRow[]): Record<string, number> | undefined {
  const weights: Record<string, number> = {}
  for (const row of rows) {
    const type = row.type.trim()
    const weight = parseWeight(row.weight)
    if (type && weight !== null) weights[type] = weight
  }
  return Object.keys(weights).length > 0 ? weights : undefined
}
