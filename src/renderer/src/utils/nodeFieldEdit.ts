import type { AnyNodeData } from '@renderer/types/ui'
import type { FieldPath, ResolvedFieldDefinition } from '@renderer/config/fieldConfig'

/**
 * Field-path helpers shared by the properties panel and the in-app terminal, so
 * a value typed in the terminal is parsed, clamped and written exactly as the
 * panel input would write it.
 */

export function getPathValue(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, target)
}

/** A node-data patch that sets `path` to `value`, cloning every object on the way. */
export function setPathValue(
  target: AnyNodeData,
  path: FieldPath,
  value: unknown
): Partial<AnyNodeData> {
  const segments = path.split('.')
  const [root, ...rest] = segments

  if (rest.length === 0) {
    return { [root]: value } as Partial<AnyNodeData>
  }

  const currentRootValue = (target as unknown as Record<string, unknown>)[root]
  const clonedRoot = Array.isArray(currentRootValue)
    ? [...currentRootValue]
    : currentRootValue && typeof currentRootValue === 'object'
      ? { ...(currentRootValue as Record<string, unknown>) }
      : {}

  let cursor: unknown = clonedRoot
  let sourceCursor: unknown = currentRootValue

  for (let index = 0; index < rest.length - 1; index++) {
    const segment = rest[index]
    const nextSegment = rest[index + 1]
    const sourceValue =
      Array.isArray(sourceCursor) && Number.isInteger(Number(segment))
        ? sourceCursor[Number(segment)]
        : sourceCursor && typeof sourceCursor === 'object'
          ? (sourceCursor as Record<string, unknown>)[segment]
          : undefined

    const nextValue = Array.isArray(sourceValue)
      ? [...sourceValue]
      : sourceValue && typeof sourceValue === 'object'
        ? { ...(sourceValue as Record<string, unknown>) }
        : Number.isInteger(Number(nextSegment))
          ? []
          : {}

    if (Array.isArray(cursor)) {
      cursor[Number(segment)] = nextValue
    } else {
      ;(cursor as Record<string, unknown>)[segment] = nextValue
    }

    cursor = nextValue
    sourceCursor = sourceValue
  }

  const lastSegment = rest[rest.length - 1]
  if (Array.isArray(cursor) && Number.isInteger(Number(lastSegment))) {
    cursor[Number(lastSegment)] = value
  } else {
    ;(cursor as Record<string, unknown>)[lastSegment] = value
  }

  return { [root]: clonedRoot } as Partial<AnyNodeData>
}

export type FieldInputResult = { ok: true; value: unknown } | { ok: false; reason: string }

const TRUE_WORDS = new Set(['on', 'true', 'yes', '1', 'enable', 'enabled'])
const FALSE_WORDS = new Set(['off', 'false', 'no', '0', 'disable', 'disabled'])

/**
 * Parse typed text into the stored value for a field, mirroring `FormField`:
 * numbers are clamped to the field bounds and then converted back from their
 * display unit; selects must be one of the options; text is stored as typed.
 */
export function coerceFieldInput(
  field: ResolvedFieldDefinition,
  raw: string,
  data: AnyNodeData
): FieldInputResult {
  const text = raw.trim()
  switch (field.type) {
    case 'select': {
      const options = field.options ?? []
      const match = options.find((option) => option.toLowerCase() === text.toLowerCase())
      if (match === undefined) {
        return {
          ok: false,
          reason: `'${text}' is not an option. Choose one of: ${options.join(', ')}.`
        }
      }
      return { ok: true, value: match }
    }
    case 'boolean': {
      const lower = text.toLowerCase()
      if (TRUE_WORDS.has(lower)) return { ok: true, value: true }
      if (FALSE_WORDS.has(lower)) return { ok: true, value: false }
      return { ok: false, reason: `Expected on or off, got '${text}'.` }
    }
    case 'slider':
    case 'input':
    default: {
      if (field.type === 'input' && field.inputType === 'text') {
        return { ok: true, value: text === '' ? undefined : text }
      }
      let parsed = Number(text.replace(/%$/, ''))
      if (text === '' || !Number.isFinite(parsed)) {
        return {
          ok: false,
          reason: `Expected a number${field.unit ? ` (${field.unit})` : ''}, got '${text}'.`
        }
      }
      if (field.min !== undefined) parsed = Math.max(field.min, parsed)
      if (field.max !== undefined) parsed = Math.min(field.max, parsed)
      return {
        ok: true,
        value: field.displayAs ? field.displayAs.fromDisplay(parsed, data) : parsed
      }
    }
  }
}
