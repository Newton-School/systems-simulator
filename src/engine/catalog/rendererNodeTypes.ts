import type { RendererNodeType } from './nodeSpecTypes'

/**
 * Renderer names used before #219, mapped to their presentation-term successors.
 * Saved canvas files, autosaved attempts, question scaffolds, host seeds and
 * Django `SIMULATOR_CONFIG` rows written before the rename still carry the old
 * names as React Flow `node.type` / `data.rendererType`; every ingest path runs
 * them through `normalizeCanvasNodeRendererTypes` so they render identically.
 * `securityNode` kept its name and so is not listed.
 *
 * This is the only place the legacy names may appear outside tests.
 */
export const LEGACY_RENDERER_NODE_TYPES: Readonly<Record<string, RendererNodeType>> = {
  serviceNode: 'standardNode',
  computeNode: 'saturationNode',
  vpcNode: 'containerNode'
}

function legacyTarget(type: unknown): RendererNodeType | undefined {
  return typeof type === 'string' && Object.hasOwn(LEGACY_RENDERER_NODE_TYPES, type)
    ? LEGACY_RENDERER_NODE_TYPES[type]
    : undefined
}

/** The current name for a renderer type; unknown and current names pass through unchanged. */
export function normalizeRendererNodeType<T extends string | undefined>(
  type: T
): T | RendererNodeType {
  return legacyTarget(type) ?? type
}

interface RendererTypedNode {
  type?: string
  data?: unknown
}

/**
 * Rewrites a legacy renderer name on `node.type` and `node.data.rendererType`.
 * Returns the same object when there is nothing to rewrite.
 */
export function normalizeCanvasNodeRendererType<T extends RendererTypedNode>(node: T): T {
  const nextType = legacyTarget(node.type)
  const data = node.data
  const nextDataType =
    typeof data === 'object' && data !== null
      ? legacyTarget((data as { rendererType?: unknown }).rendererType)
      : undefined
  if (!nextType && !nextDataType) return node

  return {
    ...node,
    ...(nextType ? { type: nextType } : {}),
    ...(nextDataType ? { data: { ...(data as object), rendererType: nextDataType } } : {})
  }
}

/**
 * `normalizeCanvasNodeRendererType` over a node list. Returns the same array when
 * no node changed, so callers on hot paths (store setters) keep reference equality.
 */
export function normalizeCanvasNodeRendererTypes<T extends RendererTypedNode>(nodes: T[]): T[] {
  let changed = false
  const next = nodes.map((node) => {
    const normalized = normalizeCanvasNodeRendererType(node)
    if (normalized !== node) changed = true
    return normalized
  })
  return changed ? next : nodes
}
