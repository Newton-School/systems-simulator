import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TopologyJSON } from '../engine/core/types'
import { validateTopology } from '../engine/validation/validator'

export type TopologyLoadResult =
  | { status: 'ok'; topology: TopologyJSON; warnings: string[] }
  | { status: 'unreadable'; message: string }
  | {
      status: 'invalid'
      message: string
      errors: Array<{ path?: string; message: string }>
      warnings: string[]
    }

/** Read + JSON-parse + validate a topology file. Never throws. */
export function loadTopologyFile(filePath: string): TopologyLoadResult {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolve(filePath), 'utf-8'))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const message =
      code === 'ENOENT'
        ? `File not found: ${filePath}`
        : `Could not read topology file ${filePath}: ${(err as Error).message}`
    return { status: 'unreadable', message }
  }

  const validation = validateTopology(raw)
  if (!validation.valid || !validation.data) {
    return {
      status: 'invalid',
      message: looksLikeCanvasExport(raw)
        ? `Topology validation failed: ${filePath} is a canvas (React Flow) file, not an engine TopologyJSON`
        : `Topology validation failed: ${filePath}`,
      errors: (validation.errors ?? []).map((error) => ({
        ...(error.path ? { path: error.path } : {}),
        message: error.message
      })),
      warnings: validation.warnings ?? []
    }
  }
  return { status: 'ok', topology: validation.data, warnings: validation.warnings ?? [] }
}

/** Canvas files carry React Flow nodes (`type: 'standardNode'`, config under `data`). */
function looksLikeCanvasExport(raw: unknown): boolean {
  const nodes = (raw as { nodes?: unknown } | null)?.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return false
  const first = nodes[0] as { data?: { componentType?: unknown } } | null
  return typeof first?.data?.componentType === 'string'
}
