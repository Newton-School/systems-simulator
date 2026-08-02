import { useEffect, useRef, useCallback } from 'react'
import { Node, Edge, XYPosition, useReactFlow } from 'reactflow'
import { useFlowStore } from './useFlowStore'

interface ClipboardNodeEntry {
  node: Node
  absolutePosition: XYPosition
  parentWasCopied: boolean
}

interface ClipboardSelection {
  nodes: ClipboardNodeEntry[]
  edges: Edge[]
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function absolutePosition(
  node: Pick<Node, 'position' | 'parentNode'>,
  byId: Map<string, Node>
): XYPosition {
  let { x, y } = node.position
  let parentId = node.parentNode
  const seen = new Set<string>()

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }

  return { x, y }
}

export function buildClipboardSelection(nodes: Node[], edges: Edge[]): ClipboardSelection {
  const selectedNodes = nodes.filter((node) => node.selected)
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const selectedEdges = edges.filter(
    (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
  )

  return {
    nodes: selectedNodes.map((node) => ({
      node: cloneValue(node),
      absolutePosition: absolutePosition(node, byId),
      parentWasCopied: !!node.parentNode && selectedNodeIds.has(node.parentNode)
    })),
    edges: cloneValue(selectedEdges)
  }
}

export function materializeClipboardSelection(
  clipboard: ClipboardSelection,
  targetFlowPos: XYPosition
): { nodes: Node[]; edges: Edge[] } {
  const { nodes: clipboardNodes, edges: clipboardEdges } = clipboard

  let minX = Infinity
  let minY = Infinity
  for (const { absolutePosition } of clipboardNodes) {
    if (absolutePosition.x < minX) minX = absolutePosition.x
    if (absolutePosition.y < minY) minY = absolutePosition.y
  }

  const offsetX = targetFlowPos.x - minX
  const offsetY = targetFlowPos.y - minY
  const idMap = new Map<string, string>()

  for (const { node } of clipboardNodes) {
    idMap.set(node.id, crypto.randomUUID())
  }

  const nodes = clipboardNodes.map(
    ({ node, absolutePosition: originalAbsolute, parentWasCopied }) => {
      const pastedNode = cloneValue(node)
      pastedNode.id = idMap.get(node.id)!
      pastedNode.selected = true

      if (parentWasCopied && node.parentNode && idMap.has(node.parentNode)) {
        pastedNode.parentNode = idMap.get(node.parentNode)!
        pastedNode.position = cloneValue(node.position)
        return pastedNode
      }

      pastedNode.parentNode = undefined
      pastedNode.extent = undefined
      pastedNode.position = {
        x: originalAbsolute.x + offsetX,
        y: originalAbsolute.y + offsetY
      }
      return pastedNode
    }
  )

  const edges = clipboardEdges.map((edge) => ({
    ...cloneValue(edge),
    id: crypto.randomUUID(),
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
    selected: true
  }))

  return { nodes, edges }
}

export const useCopyPaste = () => {
  const { nodes, edges, setNodes, setEdges } = useFlowStore()
  const storeRef = useRef({ nodes, edges })
  useEffect(() => {
    storeRef.current = { nodes, edges }
  }, [nodes, edges])

  const { screenToFlowPosition } = useReactFlow()
  const mousePosRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const clipboardRef = useRef<ClipboardSelection>({ nodes: [], edges: [] })

  const copy = useCallback(() => {
    const { nodes: currentNodes, edges: currentEdges } = storeRef.current
    const selection = buildClipboardSelection(currentNodes, currentEdges)
    if (selection.nodes.length === 0) return
    clipboardRef.current = selection
  }, [])

  const paste = useCallback(() => {
    const { nodes: clipboardNodes, edges: clipboardEdges } = clipboardRef.current
    if (clipboardNodes.length === 0) return

    const { nodes: currentNodes, edges: currentEdges } = storeRef.current
    const selection = materializeClipboardSelection(
      { nodes: clipboardNodes, edges: clipboardEdges },
      screenToFlowPosition({
        x: mousePosRef.current.x,
        y: mousePosRef.current.y
      })
    )
    const nextNodes: Node[] = [
      ...currentNodes.map((node) => ({ ...node, selected: false })),
      ...selection.nodes
    ]
    const nextEdges: Edge[] = [
      ...currentEdges.map((edge) => ({ ...edge, selected: false })),
      ...selection.edges
    ]

    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [setNodes, setEdges, screenToFlowPosition])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (!(event.metaKey || event.ctrlKey)) {
        return
      }
      const key = event.key.toLowerCase()

      if (key === 'c') {
        // Never hijack a real text selection or a bare Cmd+C with nothing on the
        // canvas selected — let the browser's normal copy run instead. We only
        // take over when the user is actually copying selected canvas nodes.
        const hasTextSelection = (window.getSelection()?.toString().length ?? 0) > 0
        const hasNodeSelection = storeRef.current.nodes.some((node) => node.selected)
        if (hasTextSelection || !hasNodeSelection) {
          return
        }
        event.preventDefault()
        copy()
        return
      }

      if (key === 'v') {
        // Only intercept paste when there are canvas nodes on our clipboard;
        // otherwise leave the browser's paste (into inputs, etc.) untouched.
        if (clipboardRef.current.nodes.length === 0) {
          return
        }
        event.preventDefault()
        paste()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [copy, paste])
}
