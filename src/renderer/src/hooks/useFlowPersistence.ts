import { useCallback, useEffect, useRef } from 'react'
import useStore from '@renderer/store/useStore'
import { useFileHandlers } from './useFileHandlers'
import {
  convertFlatToNested,
  convertNestedToFlat,
  NestedFileData
} from '@renderer/utils/nodeTransformers'
import { migrateCanvasNodes } from '../../../engine/catalog/legacyCanvasMigration'
import { normalizeScenarioState } from '@renderer/types/ui'

const extractFileName = (path: string): string => {
  return path.replace(/^.*[\\/]/, '')
}

const useKeyboardShortcuts = (onSave: () => void, onOpen: () => void) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (!isMod) return

      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        onSave()
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault()
        onOpen()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSave, onOpen])
}

export const useFlowPersistence = () => {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const setNodes = useStore((s) => s.setNodes)
  const setEdges = useStore((s) => s.setEdges)
  const setFileName = useStore((s) => s.setFileName)
  const setUnsaved = useStore((s) => s.setUnsaved)
  const scenario = useStore((s) => s.scenario)
  const setScenario = useStore((s) => s.setScenario)

  const isLoadingRef = useRef(false)

  const handleGetFileData = useCallback(() => {
    const { nodes, edges } = useStore.getState()
    const nestedNodes = convertFlatToNested(nodes)
    return JSON.stringify({ version: '2.0.0', nodes: nestedNodes, edges, scenario }, null, 2)
  }, [scenario])

  const handleLoadFileData = useCallback(
    (fileContent: string | object, filePath?: string) => {
      try {
        const data = (
          typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent
        ) as NestedFileData

        if (!data?.nodes) throw new Error('Invalid file format')

        const flatNodes = migrateCanvasNodes(convertNestedToFlat(data.nodes))

        isLoadingRef.current = true

        setNodes(flatNodes)
        setEdges(data.edges || [])
        setScenario(normalizeScenarioState(data.scenario))
        setUnsaved(false)

        if (filePath && typeof filePath === 'string') {
          setFileName(extractFileName(filePath))
        }

        setTimeout(() => {
          isLoadingRef.current = false
        }, 100)
      } catch (error) {
        console.error('Failed to load flow:', error)
        alert('Error loading file.')
        isLoadingRef.current = false
      }
    },
    [setEdges, setFileName, setNodes, setScenario, setUnsaved]
  )

  const { handleSave: innerSave, handleOpen } = useFileHandlers(
    handleGetFileData,
    handleLoadFileData
  )

  const confirmIfUnsaved = async (): Promise<boolean> => {
    const { isUnsaved } = useStore.getState()
    if (!isUnsaved) return true

    return window.confirm('You have unsaved changes. Discard changes and continue?')
  }

  const handleOpenWithCheckIfSaved = useCallback(async () => {
    const ok = await confirmIfUnsaved()
    if (!ok) return

    handleOpen()
  }, [handleOpen])

  const handleSaveWrapper = useCallback(async () => {
    const savedPath = await innerSave()

    if (savedPath && typeof savedPath === 'string') {
      setFileName(extractFileName(savedPath))
      setUnsaved(false)
    }
  }, [innerSave, setFileName, setUnsaved])

  useKeyboardShortcuts(handleSaveWrapper, handleOpenWithCheckIfSaved)

  useEffect(() => {
    if (isLoadingRef.current) return

    if (nodes.length > 0) {
      setUnsaved(true)
    }
  }, [edges, nodes, scenario, setUnsaved])

  return { handleSave: handleSaveWrapper, handleOpen: handleOpenWithCheckIfSaved }
}
