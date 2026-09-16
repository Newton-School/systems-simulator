export type ShortcutKey =
  | 'Mod'
  | 'Shift'
  | 'Alt'
  | 'Enter'
  | 'Space'
  | 'Backspace'
  | 'Delete'
  | 'Escape'
  | 'Click'
  | 'Double-click'
  | 'Drag'
  | 'Middle drag'
  | 'Right drag'
  | string

export interface KeyboardShortcutItem {
  id: string
  label: string
  description: string
  keys: ShortcutKey[][]
}

export interface KeyboardShortcutGroup {
  id: string
  label: string
  description: string
  shortcuts: KeyboardShortcutItem[]
}

/**
 * The user-facing shortcut catalogue. Keep this in sync with the handlers in
 * WorkspaceLayout, FlowCanvas, useCopyPaste, and useFlowPersistence.
 */
export const KEYBOARD_SHORTCUT_GROUPS: KeyboardShortcutGroup[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Files, examples, and simulation controls.',
    shortcuts: [
      {
        id: 'show-shortcuts',
        label: 'Keyboard shortcuts',
        description: 'Open or close this cheatsheet.',
        keys: [['?'], ['Mod', '/']]
      },
      {
        id: 'save',
        label: 'Save scenario',
        description: 'Save the current topology when file access is available.',
        keys: [['Mod', 'S']]
      },
      {
        id: 'open',
        label: 'Open scenario',
        description: 'Open a topology file when file access is available.',
        keys: [['Mod', 'O']]
      },
      {
        id: 'browse-examples',
        label: 'Browse examples',
        description: 'Open the sample-scenario picker.',
        keys: [['Mod', 'Shift', 'O']]
      },
      {
        id: 'run-simulation',
        label: 'Run simulation',
        description: 'Start a run with the current topology and scenario.',
        keys: [['Mod', 'Enter']]
      },
      {
        id: 'open-settings',
        label: 'Open settings',
        description: 'Available in Author mode; hidden in Practice and Assignment modes.',
        keys: [['Mod', ',']]
      }
    ]
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Arrange the canvas and show or hide workspace panels.',
    shortcuts: [
      {
        id: 'toggle-library',
        label: 'Toggle component library',
        description: 'Show or hide the left library panel.',
        keys: [['Mod', 'B']]
      },
      {
        id: 'focus-library-search',
        label: 'Search component library',
        description: 'Open the Component Library tab and focus its search box.',
        keys: [['/'], ['Mod', 'K']]
      },
      {
        id: 'switch-left-tab',
        label: 'Switch left tab',
        description: 'Open the matching visible tab; newly introduced tabs follow the same order.',
        keys: [['Mod', '1…9']]
      },
      {
        id: 'toggle-node-config',
        label: 'Toggle selected item config',
        description: 'Show or hide the right panel when a node or edge is selected.',
        keys: [['Mod', 'I']]
      },
      {
        id: 'toggle-results',
        label: 'Toggle results tray',
        description: 'Show or hide results after a simulation has started.',
        keys: [['Mod', 'J']]
      },
      {
        id: 'toggle-run-inspector',
        label: 'Toggle run inspector',
        description: 'Show or hide the right-side run inspector when run data exists.',
        keys: [['Mod', 'Shift', 'I']]
      },
      {
        id: 'auto-layout',
        label: 'Auto-arrange topology',
        description: 'Lay out all nodes, then fit the topology into view.',
        keys: [['Mod', 'Shift', 'L']]
      }
    ]
  },
  {
    id: 'canvas-tools',
    label: 'Canvas tools',
    description: 'Switch tools permanently or hold a key for a temporary tool.',
    shortcuts: [
      {
        id: 'select-tool',
        label: 'Select tool',
        description: 'Click items or drag blank canvas to make a selection.',
        keys: [['1'], ['V']]
      },
      {
        id: 'pan-tool',
        label: 'Move canvas tool',
        description: 'Drag the background to pan the canvas.',
        keys: [['2'], ['H']]
      },
      {
        id: 'text-tool',
        label: 'Label tool',
        description: 'Click blank canvas to add labels; double-click a label to edit it.',
        keys: [['3'], ['T']]
      },
      {
        id: 'temporary-select',
        label: 'Temporary select',
        description: 'Hold to select; release to return to the previous tool.',
        keys: [['Shift']]
      },
      {
        id: 'temporary-pan',
        label: 'Temporary move canvas',
        description: 'Hold to pan; release to return to the previous tool.',
        keys: [['Space']]
      }
    ]
  },
  {
    id: 'metric-lenses',
    label: 'Metric lenses',
    description: 'The same controls target the visible pre-run or runtime lens set.',
    shortcuts: [
      {
        id: 'previous-lens',
        label: 'Previous lens',
        description: 'Move left through the current metric lens set.',
        keys: [['[']]
      },
      {
        id: 'next-lens',
        label: 'Next lens',
        description: 'Move right through the current metric lens set.',
        keys: [[']']]
      },
      {
        id: 'choose-lens',
        label: 'Choose lens by position',
        description: 'Select lens 1–5 from the current pre-run or runtime set.',
        keys: [['Alt', '1…5']]
      }
    ]
  },
  {
    id: 'canvas-view',
    label: 'Canvas view',
    description: 'Navigate without changing the topology.',
    shortcuts: [
      {
        id: 'fit-view',
        label: 'Fit topology',
        description: 'Center and scale the entire topology into view.',
        keys: [['F']]
      },
      {
        id: 'actual-size',
        label: 'Reset zoom',
        description: 'Return the canvas to 100% zoom.',
        keys: [['0']]
      },
      {
        id: 'zoom-in',
        label: 'Zoom in',
        description: 'Increase the canvas zoom level.',
        keys: [['+'], ['=']]
      },
      {
        id: 'zoom-out',
        label: 'Zoom out',
        description: 'Decrease the canvas zoom level.',
        keys: [['-']]
      }
    ]
  },
  {
    id: 'editing',
    label: 'Canvas editing',
    description: 'Edit the graph while keeping native text-field shortcuts intact.',
    shortcuts: [
      {
        id: 'select-all',
        label: 'Select everything',
        description: 'Select every node and edge on the canvas.',
        keys: [['Mod', 'A']]
      },
      {
        id: 'copy',
        label: 'Copy selection',
        description: 'Copy selected nodes and the edges between them.',
        keys: [['Mod', 'C']]
      },
      {
        id: 'paste',
        label: 'Paste at pointer',
        description: 'Paste copied nodes at the current pointer position.',
        keys: [['Mod', 'V']]
      },
      {
        id: 'undo',
        label: 'Undo',
        description: 'Undo the latest topology change.',
        keys: [['Mod', 'Z']]
      },
      {
        id: 'redo',
        label: 'Redo',
        description: 'Redo the latest undone topology change.',
        keys: [
          ['Mod', 'Shift', 'Z'],
          ['Ctrl', 'Y']
        ]
      },
      {
        id: 'delete-selection',
        label: 'Delete selection',
        description: 'Remove selected editable nodes and edges.',
        keys: [['Backspace'], ['Delete']]
      },
      {
        id: 'clear-selection',
        label: 'Clear selection',
        description: 'Deselect every node and edge.',
        keys: [['Escape']]
      }
    ]
  },
  {
    id: 'canvas-gestures',
    label: 'Canvas gestures',
    description: 'Mouse gestures change with the active canvas tool.',
    shortcuts: [
      {
        id: 'add-to-selection',
        label: 'Add or remove from selection',
        description: 'Use with the Select tool to toggle an item in the selection.',
        keys: [['Shift', 'Click']]
      },
      {
        id: 'marquee-selection',
        label: 'Marquee select',
        description: 'Drag blank canvas with the Select tool active.',
        keys: [['Drag']]
      },
      {
        id: 'pan-any-tool',
        label: 'Pan from any tool',
        description: 'Pan without switching away from the current tool.',
        keys: [['Middle drag'], ['Right drag']]
      },
      {
        id: 'create-connection',
        label: 'Create connection',
        description: 'Drag from a source handle to a compatible target handle.',
        keys: [['Drag', 'port']]
      },
      {
        id: 'open-properties',
        label: 'Open node properties',
        description: 'Select a node and open it in the right inspector.',
        keys: [['Double-click', 'node']]
      }
    ]
  }
]

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

export function formatShortcutKey(key: ShortcutKey, apple = isApplePlatform()): string {
  if (key === 'Mod') return apple ? '⌘' : 'Ctrl'
  if (key === 'Alt') return apple ? '⌥' : 'Alt'
  if (key === 'Backspace' && apple) return '⌫'
  return key
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !==
      null
  )
}

export function isModalOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelector('[role="dialog"][aria-modal="true"]') !== null
  )
}

export function isPrimaryModifier(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey
}
