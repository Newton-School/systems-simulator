export interface ClassroomAnswerKeyRow {
  copies: number
  utilization: number
  passes: boolean
}

export interface ClassroomAnswerKey {
  rows: ClassroomAnswerKeyRow[]
  smallestPassingCopies: number | null
}

/** Deterministic napkin-math table shared by Studio and validators. */
export function buildClassroomAnswerKey(input: {
  peakRps: number
  capacityRps: number
  maxUtilization: number
  maxCopies: number
}): ClassroomAnswerKey {
  const { peakRps, capacityRps, maxUtilization } = input
  const maxCopies = Math.floor(input.maxCopies)
  if (
    !Number.isFinite(peakRps) ||
    peakRps <= 0 ||
    !Number.isFinite(capacityRps) ||
    capacityRps <= 0 ||
    !Number.isFinite(maxUtilization) ||
    maxUtilization <= 0 ||
    maxUtilization > 1 ||
    !Number.isFinite(maxCopies) ||
    maxCopies < 1
  ) {
    return { rows: [], smallestPassingCopies: null }
  }

  const rows = Array.from({ length: maxCopies }, (_, index) => {
    const copies = index + 1
    const utilization = peakRps / (capacityRps * copies)
    return { copies, utilization, passes: utilization <= maxUtilization }
  })
  return {
    rows,
    smallestPassingCopies: rows.find((row) => row.passes)?.copies ?? null
  }
}
