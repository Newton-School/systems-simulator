import { create } from 'zustand'
import type { ContextualAddRequest } from '../utils/contextualAdd'

/**
 * Canvas-local state for the contextual add picker. Node menus (rendered inside
 * React Flow's transformed node layer) open the picker; the canvas renders it
 * in screen space so it is not scaled or clipped by the node it belongs to.
 */
interface ContextualAddState {
  /** False while the canvas is locked (presentation, frozen attempt, read-only). */
  enabled: boolean
  request: ContextualAddRequest | null
  setEnabled: (enabled: boolean) => void
  open: (request: ContextualAddRequest) => void
  close: () => void
}

export const useContextualAdd = create<ContextualAddState>((set, get) => ({
  enabled: true,
  request: null,
  setEnabled: (enabled) => set(enabled ? { enabled } : { enabled, request: null }),
  open: (request) => {
    if (!get().enabled) return
    set({ request })
  },
  close: () => set({ request: null })
}))
