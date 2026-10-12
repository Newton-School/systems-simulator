import { useCallback } from 'react'
import useStore from '@renderer/store/useStore'
import type { TopologyJSON } from '../../../engine/core/types'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'
import { FileService } from '@renderer/services/FileService'

export type ExportOutcome = { ok: true; message: string } | { ok: false; message: string }

/** Current canvas as TopologyJSON (lenient: a work-in-progress design still exports). */
export function currentTopologyJson(): TopologyJSON | null {
  const state = useStore.getState()
  // Authored edges even in connector mode (the run neutralizes them, the
  // document must not), so an exported design imports back unchanged.
  return serializeCanvasToTopology(
    { nodes: state.nodes, edges: state.edges, scenario: state.scenario },
    { lenient: true }
  ).topology
}

export function topologyFileName(topology: TopologyJSON): string {
  const slug = topology.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'topology'}.topology.json`
}

/**
 * Export TopologyJSON (#89): download it as a file or copy it to the clipboard.
 * Distinct from Save, which writes the app's own canvas file (layout,
 * annotations); this writes the engine's TopologyJSON.
 */
export function useTopologyJsonExport() {
  const download = useCallback(async (): Promise<ExportOutcome> => {
    const topology = currentTopologyJson()
    if (!topology) return { ok: false, message: 'There is nothing on the canvas to export.' }
    const saved = await FileService.save(
      JSON.stringify(topology, null, 2),
      topologyFileName(topology),
      {
        saveAsNewFile: true,
        dialogTitle: 'Export TopologyJSON',
        fileDescription: 'TopologyJSON'
      }
    )
    return saved
      ? { ok: true, message: `Exported ${saved.name}` }
      : { ok: false, message: 'Export cancelled.' }
  }, [])

  const copy = useCallback(async (): Promise<ExportOutcome> => {
    const topology = currentTopologyJson()
    if (!topology) return { ok: false, message: 'There is nothing on the canvas to copy.' }
    const text = JSON.stringify(topology, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      return { ok: true, message: 'TopologyJSON copied to the clipboard.' }
    } catch {
      if (copyWithSelection(text)) {
        return { ok: true, message: 'TopologyJSON copied to the clipboard.' }
      }
      return {
        ok: false,
        message: 'The browser blocked clipboard access. Use Download instead.'
      }
    }
  }, [])

  return { download, copy }
}

/** Fallback for browsers or frames where the async clipboard API is blocked. */
function copyWithSelection(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
