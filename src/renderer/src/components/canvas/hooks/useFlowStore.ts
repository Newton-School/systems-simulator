import { useShallow } from 'zustand/react/shallow'
import useStore from '@renderer/store/useStore'

export const useFlowStore = () => {
  return useStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
      addNode: state.addNode,
      setNodes: state.setNodes,
      setEdges: state.setEdges,
      setGraph: state.setGraph,
      updateNodeData: state.updateNodeData,
      updateEdgeData: state.updateEdgeData,
      canUndoGraph: state.graphHistory.past.length > 0,
      canRedoGraph: state.graphHistory.future.length > 0,
      undoGraph: state.undoGraph,
      redoGraph: state.redoGraph
    }))
  )
}
