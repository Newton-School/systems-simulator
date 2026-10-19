import { useMemo } from 'react'
import useStore from '@renderer/store/useStore'
import { CATALOG_CONFIG } from '../config/catalogConfig'
import { filterCatalogCategories, type ComponentLibraryFilter } from '../config/catalogFilter'
import { useClassroomActive } from '@renderer/hooks/useClassroom'
import type { CatalogCategory } from '@renderer/types/ui'

/**
 * The component library as the current question and settings allow it. Shared by the sidebar
 * library and the Add popover so both offer exactly the same components.
 */
export function useLibraryCatalog(
  query: string,
  filter: ComponentLibraryFilter
): {
  categories: CatalogCategory[]
  /** A question allow-list or Classroom mode has already curated the palette. */
  curated: boolean
} {
  const editPaletteList = useStore((state) => state.environmentProfile.capabilities.editPaletteList)
  const activeQuestion = useStore((state) => state.activeQuestion)
  const componentLibraryMode = useStore((state) => state.displaySettings.componentLibraryMode)
  const hiddenTemplateIds = useStore(
    (state) => state.displaySettings.hiddenComponentLibraryTemplateIds
  )
  const classroomActive = useClassroomActive()

  const categories = useMemo(
    () =>
      filterCatalogCategories(CATALOG_CONFIG, {
        query,
        filter,
        editPaletteList,
        allowedNodeTypes: activeQuestion?.constraints.allowedNodeTypes ?? null,
        forbiddenNodeTypes: activeQuestion?.constraints.forbiddenNodeTypes ?? null,
        componentLibraryMode,
        hiddenTemplateIds,
        ...(classroomActive ? { classroom: { settings: activeQuestion?.classroom } } : {})
      }),
    [
      activeQuestion,
      classroomActive,
      componentLibraryMode,
      editPaletteList,
      filter,
      hiddenTemplateIds,
      query
    ]
  )

  return {
    categories,
    curated: Boolean(activeQuestion?.constraints.allowedNodeTypes) || classroomActive
  }
}
