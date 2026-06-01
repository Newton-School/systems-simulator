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

const DEFAULT_FILE_NAME = 'scenario.json'

const normalizeSuggestedFileName = (fileName: string | null): string => {
  if (!fileName || fileName.trim().length === 0 || fileName === 'Untitled') {
    return DEFAULT_FILE_NAME
  }

  return fileName.toLowerCase().endsWith('.json') ? fileName : `${fileName}.json`
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

export const useFlowPersistence = (confirmDiscardChanges: () => Promise<boolean>) => {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const setNodes = useStore((s) => s.setNodes)
  const setEdges = useStore((s) => s.setEdges)
  const setFileName = useStore((s) => s.setFileName)
  const setUnsaved = useStore((s) => s.setUnsaved)
  const scenario = useStore((s) => s.scenario)
  const setScenario = useStore((s) => s.setScenario)

  const isLoadingRef = useRef(false)
  const lastPersistedContentRef = useRef<string | null>(null)

  const handleGetFileData = useCallback(() => {
    const { nodes, edges } = useStore.getState()
    const nestedNodes = convertFlatToNested(nodes)
    return JSON.stringify({ version: '2.0.0', nodes: nestedNodes, edges, scenario }, null, 2)
  }, [scenario])

  const handleLoadFileData = useCallback(
    (fileContent: string | object, fileName?: string) => {
      try {
        const data = (
          typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent
        ) as NestedFileData

        if (!data?.nodes) throw new Error('Invalid file format')

        const flatNodes = migrateCanvasNodes(convertNestedToFlat(data.nodes))
        const normalizedScenario = normalizeScenarioState(data.scenario)
        const serializedSnapshot = JSON.stringify(
          {
            version: '2.0.0',
            nodes: convertFlatToNested(flatNodes),
            edges: data.edges || [],
            scenario: normalizedScenario
          },
          null,
          2
        )

        isLoadingRef.current = true
        lastPersistedContentRef.current = serializedSnapshot

        setNodes(flatNodes)
        setEdges(data.edges || [])
        setScenario(normalizedScenario)
        setUnsaved(false)

        if (fileName && typeof fileName === 'string') {
          setFileName(fileName)
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

    try {
      return await confirmDiscardChanges()
    } catch (error) {
      console.error('Error during confirmDiscard:', error)
      return false
    }
  }

  const handleOpenWithCheckIfSaved = useCallback(async () => {
    const ok = await confirmIfUnsaved()
    if (!ok) return

    handleOpen()
  }, [handleOpen])

  const handleSaveWrapper = useCallback(async () => {
    const savedFile = await innerSave(normalizeSuggestedFileName(useStore.getState().fileName))

    if (savedFile?.name) {
      lastPersistedContentRef.current = handleGetFileData()
      setFileName(savedFile.name)
      setUnsaved(false)
    }
  }, [handleGetFileData, innerSave, setFileName, setUnsaved])

  useKeyboardShortcuts(handleSaveWrapper, handleOpenWithCheckIfSaved)

  useEffect(() => {
    const currentSnapshot = handleGetFileData()

    if (lastPersistedContentRef.current === null) {
      lastPersistedContentRef.current = currentSnapshot
      return
    }

    if (isLoadingRef.current) return

    setUnsaved(currentSnapshot !== lastPersistedContentRef.current)
  }, [edges, handleGetFileData, nodes, scenario, setUnsaved])

  return { handleSave: handleSaveWrapper, handleOpen: handleOpenWithCheckIfSaved }
}
