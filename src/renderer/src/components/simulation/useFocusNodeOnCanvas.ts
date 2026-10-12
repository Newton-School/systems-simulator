import { useCallback } from 'react'
import useStore from '../../store/useStore'

/**
 * Results-tray row linking: select a node on the canvas and pan/zoom to it.
 * Ignores ids that are no longer on the canvas (e.g. the graph was edited
 * after the run).
 */
export function useFocusNodeOnCanvas(): (nodeId: string) => void {
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const requestViewportFocus = useStore((state) => state.requestViewportFocus)
  return useCallback(
    (nodeId: string) => {
      if (!useStore.getState().nodes.some((node) => node.id === nodeId)) {
        return
      }
      selectGraphElements({ nodeId })
      requestViewportFocus([nodeId])
    },
    [requestViewportFocus, selectGraphElements]
  )
}
