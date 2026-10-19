import type { DefinitionBuilderMode } from './CustomDefinitionCreator'

/** Library tiles that open a definition builder instead of placing a node. */
export const BUILDER_ENTRY_LABELS: Readonly<Record<DefinitionBuilderMode, string>> = {
  service: 'Service builder',
  'my-service': 'My Services',
  'custom-node': 'Custom Node builder'
}

export const BUILDER_TEMPLATE_MODES: Readonly<Record<string, DefinitionBuilderMode>> = {
  'generic-service': 'service',
  'my-service': 'my-service',
  'custom-node-builder': 'custom-node'
}
