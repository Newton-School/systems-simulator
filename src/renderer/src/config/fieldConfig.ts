import type { AnyNodeData } from '@renderer/types/ui'
import { NODE_CONFIG_MODULES, moduleAppliesToNode } from '../../../engine/traits/capabilityModules'
import type {
  AccuracyClass,
  ConfigCustomRenderer,
  ConfigDisplayTransform,
  ConfigField,
  ConfigNoteTone,
  FieldPath
} from '../../../engine/traits/types'

export type { AccuracyClass, FieldPath } from '../../../engine/traits/types'

export interface ResolvedFieldDefinition {
  path: FieldPath
  type: ConfigField['type']
  label: string
  unit?: string
  step?: number
  min?: number
  max?: number
  defaultValue?: boolean
  options?: readonly string[]
  why?: string
  altitude: 'primary' | 'advanced'
  optional: boolean
  accuracy: AccuracyClass
  renderer: ConfigCustomRenderer
  displayAs?: ConfigDisplayTransform
  placeholder?: string
}

export interface ResolvedConfigSection {
  id: string
  title: string
  fields: ResolvedFieldDefinition[]
  note?: {
    tone: ConfigNoteTone
    text: string
  }
}

function resolveText(
  value: string | ((data: AnyNodeData) => string) | undefined,
  data: AnyNodeData
): string | undefined {
  if (typeof value === 'function') {
    return value(data)
  }

  return value
}

function resolveNote(
  value: string | ((data: AnyNodeData) => string | null) | undefined,
  data: AnyNodeData
): string | undefined {
  if (typeof value === 'function') {
    return value(data) ?? undefined
  }

  return value
}

function fieldVisible(field: ConfigField, data: AnyNodeData): boolean {
  return field.visible ? field.visible(data) : true
}

function resolveField(field: ConfigField, data: AnyNodeData): ResolvedFieldDefinition {
  const base = {
    path: field.path,
    type: field.type,
    label: resolveText(field.label, data) ?? field.path,
    unit: resolveText(field.unit, data),
    why: field.why,
    altitude: field.altitude ?? 'primary',
    optional: field.optional ?? false,
    accuracy: field.accuracy ?? 'user-parameter',
    renderer: field.renderer ?? 'default',
    displayAs: field.displayAs,
    placeholder: resolveText(field.placeholder, data)
  } satisfies Omit<ResolvedFieldDefinition, 'options' | 'min' | 'max' | 'step' | 'defaultValue'>

  switch (field.type) {
    case 'slider':
      return {
        ...base,
        min: field.min,
        max: field.max
      }
    case 'select':
      return {
        ...base,
        options: typeof field.options === 'function' ? field.options(data) : field.options
      }
    case 'boolean':
      return {
        ...base,
        defaultValue: field.defaultValue
      }
    case 'input':
    default:
      return {
        ...base,
        step: field.step
      }
  }
}

function mergeSection(
  target: ResolvedConfigSection,
  incoming: ResolvedConfigSection
): ResolvedConfigSection {
  return {
    ...target,
    fields: [...target.fields, ...incoming.fields],
    note: target.note ?? incoming.note
  }
}

function createForbiddenSection(
  moduleName: string,
  title: string,
  text: string
): ResolvedConfigSection {
  return {
    id: `${moduleName}:forbidden`,
    title,
    fields: [],
    note: {
      tone: 'locked',
      text
    }
  }
}

export function getNodeConfigSections(data: AnyNodeData): ResolvedConfigSection[] {
  const sections = new Map<string, ResolvedConfigSection>()

  for (const module of NODE_CONFIG_MODULES) {
    const applies = moduleAppliesToNode(module, data)
    const forbidden =
      typeof data.componentType === 'string' &&
      module.forbiddenOn?.types.includes(data.componentType)
        ? module.forbiddenOn
        : undefined

    if (!applies && !forbidden) {
      continue
    }

    if (forbidden && !applies) {
      const section = createForbiddenSection(
        module.name,
        forbidden.sectionTitle ?? resolveText(module.config?.sections[0]?.title, data) ?? 'Config',
        forbidden.lockedNote
      )
      sections.set(section.id, section)
      continue
    }

    for (const section of module.config?.sections ?? []) {
      const resolvedFields = section.fields
        .filter((field) => fieldVisible(field, data))
        .map((field) => resolveField(field, data))

      const noteText = resolveNote(section.note, data)

      if (resolvedFields.length === 0 && !noteText) {
        continue
      }

      const resolvedSection: ResolvedConfigSection = {
        id: section.id,
        title: resolveText(section.title, data) ?? section.id,
        fields: resolvedFields,
        note: noteText
          ? {
              tone: section.noteTone ?? 'info',
              text: noteText
            }
          : undefined
      }

      const existing = sections.get(section.id)
      sections.set(section.id, existing ? mergeSection(existing, resolvedSection) : resolvedSection)
    }
  }

  return Array.from(sections.values())
}
