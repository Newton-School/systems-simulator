import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import type { FaultTargetOption } from '@renderer/types/ui'

const CONTAINER_KIND_BY_TEMPLATE: Record<string, string> = {
  'vpc-region': 'Region',
  'availability-zone': 'Availability zone',
  subnet: 'Subnet'
}

interface FaultTargetCanvasNode {
  id: string
  parentNode?: string
  data?: unknown
}

function dataOf(node: FaultTargetCanvasNode): Partial<CanvasNodeDataV2> {
  return typeof node.data === 'object' && node.data !== null
    ? (node.data as Partial<CanvasNodeDataV2>)
    : {}
}

function cleanLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isRuntimeComponent(node: FaultTargetCanvasNode): boolean {
  const data = dataOf(node)
  return data.profile !== 'source' && data.structuralRole !== 'composite'
}

/**
 * Everything the "inject a failure" controls can target: runtime components,
 * then the Region / AZ / Subnet containers (a fault on a container fails every
 * component inside it). Containers with nothing inside are kept but marked
 * empty, so picking one is not a surprise.
 */
export function buildFaultTargetOptions(
  nodes: readonly FaultTargetCanvasNode[]
): FaultTargetOption[] {
  const components: FaultTargetOption[] = nodes.filter(isRuntimeComponent).map((node) => {
    const label = cleanLabel(dataOf(node).label)
    return { id: node.id, label: label ? `${label} (${node.id})` : node.id, group: 'component' }
  })

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const memberCount = new Map<string, number>()
  for (const node of nodes) {
    if (!isRuntimeComponent(node)) continue
    let parentId = node.parentNode
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      memberCount.set(parentId, (memberCount.get(parentId) ?? 0) + 1)
      parentId = byId.get(parentId)?.parentNode
    }
  }

  const containers: FaultTargetOption[] = nodes.flatMap((node) => {
    const data = dataOf(node)
    const kind =
      typeof data.templateId === 'string' ? CONTAINER_KIND_BY_TEMPLATE[data.templateId] : undefined
    if (!kind) return []
    const label = cleanLabel(data.label) ?? node.id
    const code = cleanLabel(data.sim?.locationId)
    const count = memberCount.get(node.id) ?? 0
    const name = code && code !== label ? `${label} (${code})` : label
    return [
      {
        id: node.id,
        label: `${kind}: ${name} - ${count === 0 ? 'empty' : `${count} component${count === 1 ? '' : 's'}`}`,
        group: 'location' as const
      }
    ]
  })

  return [...components, ...containers]
}
