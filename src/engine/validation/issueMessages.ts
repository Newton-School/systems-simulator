/**
 * Turns validation output into plain-English, user-facing copy (#223).
 *
 * - `describeZodIssue` rewords a structural (Zod) issue as `<UI label> <rule>.`, e.g.
 *   `nodes.2.queue.workers` + "expected int" -> `Workers must be a whole number.`
 * - `withSubjects` prefixes each error with the thing it belongs to, using the labels the
 *   user gave it: `API Server: ...`, `Client -> API Server: ...`, `Simulation settings: ...`.
 *
 * Paths stay machine-readable on `ValidationError.path`; only `message` is reworded.
 */
import type { z } from 'zod'
import {
  edgeFieldLabel,
  globalFieldLabel,
  humanizeFieldKey,
  nodeFieldLabel,
  splitFieldPath,
  workloadFieldLabel
} from './fieldLabels'
import { instanceCountWithinMax } from './validationCopy'

type ZodIssue = z.core.$ZodIssue
type PathKey = PropertyKey

interface SubjectError {
  path: string
  message: string
  subject?: string | null
}

const MAX_LISTED_OPTIONS = 8

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function valueAtPath(root: unknown, path: readonly PathKey[]): unknown {
  let current: unknown = root
  for (const key of path) {
    const record = asRecord(current)
    if (!record) return undefined
    current = record[key as string]
  }
  return current
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function formatOption(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

function listOptions(values: readonly unknown[]): string {
  const options = values.map(formatOption)
  if (options.length <= 1) return options[0] ?? ''
  return `${options.slice(0, -1).join(', ')}, or ${options[options.length - 1]}`
}

/** The predicate for one Zod issue, without the field label or trailing period. */
function describeRule(issue: ZodIssue, value: unknown): string {
  switch (issue.code) {
    case 'invalid_type': {
      if (value === undefined || value === null) return 'is missing'
      const expected = String(issue.expected)
      if (expected === 'int') return 'must be a whole number'
      if (expected === 'number') {
        return typeof value === 'number' ? 'must be a finite number' : 'must be a number'
      }
      if (expected === 'boolean') return 'must be either on or off'
      if (expected === 'string') return 'must be text'
      if (expected === 'array' || expected === 'tuple') return 'must be a list'
      return 'has the wrong format'
    }
    case 'too_small': {
      const minimum = Number(issue.minimum)
      if (issue.origin === 'string') {
        return minimum <= 1 ? 'cannot be empty' : `must be at least ${minimum} characters`
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return minimum <= 1 ? 'needs at least one entry' : `needs at least ${minimum} entries`
      }
      return issue.inclusive ? `must be ${minimum} or greater` : `must be greater than ${minimum}`
    }
    case 'too_big': {
      const maximum = Number(issue.maximum)
      if (issue.origin === 'string') return `must be at most ${maximum} characters`
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `can have at most ${maximum} entries`
      }
      if (maximum === 1 && issue.inclusive) return 'must be between 0 and 1 (0-100%)'
      return issue.inclusive ? `must be ${maximum} or less` : `must be less than ${maximum}`
    }
    case 'invalid_value': {
      if (issue.values.length === 1) return `must be ${formatOption(issue.values[0])}`
      if (issue.values.length <= MAX_LISTED_OPTIONS) return `must be ${listOptions(issue.values)}`
      return typeof value === 'string'
        ? `does not support '${value}'; choose a supported option`
        : 'must be one of the supported options'
    }
    case 'invalid_union':
      return 'is not valid'
    default:
      return 'is not valid'
  }
}

/** The label for the field at a full topology path, e.g. `['nodes', 2, 'queue', 'workers']`. */
function labelForTopologyPath(path: readonly PathKey[], input: unknown): string {
  const [root, index, ...rest] = path.map(String)
  const relative = rest.join('.')
  if (root === 'nodes' && index !== undefined && /^\d+$/.test(index)) {
    if (rest.length === 0) return 'Component'
    const node = asRecord(valueAtPath(input, ['nodes', Number(index)]))
    return nodeFieldLabel(relative, { componentType: stringValue(node?.type) })
  }
  if (root === 'edges' && index !== undefined && /^\d+$/.test(index)) {
    return rest.length === 0 ? 'Connection' : edgeFieldLabel(relative)
  }
  if (root === 'workload' && index !== undefined) {
    const segments = [index, ...rest]
    const label = workloadFieldLabel(segments.join('.'))
    const [list, position] = segments
    if ((list === 'requestDistribution' || list === 'origins') && /^\d+$/.test(position ?? '')) {
      const container = list === 'origins' ? 'traffic origin' : 'request template'
      return `${label} on ${container} ${Number(position) + 1}`
    }
    return label
  }
  if (root === 'global' && index !== undefined) {
    return globalFieldLabel(index)
  }
  const named = path.map(String).filter((segment) => !/^\d+$/.test(segment))
  return humanizeFieldKey(named[named.length - 1] ?? 'value')
}

/**
 * Picks the most relevant branch of a failed union (for distributions: the branch whose
 * `type` matched, so a bad sigma reads "Sigma must be greater than 0", not "is not valid").
 */
function unionBranchIssue(issue: ZodIssue): ZodIssue | undefined {
  if (issue.code !== 'invalid_union') return undefined
  const errors = (issue as { errors?: readonly (readonly ZodIssue[])[] }).errors
  if (!Array.isArray(errors)) return undefined
  const branches = errors.filter((branch) => branch.length > 0)
  const matched = branches.find(
    (branch) =>
      !branch.some(
        (candidate) =>
          candidate.code === 'invalid_value' && String(candidate.path.at(-1)) === 'type'
      )
  )
  const first = (matched ?? branches[0])?.[0]
  return first ? { ...first, path: [...issue.path, ...first.path] } : undefined
}

/** A complete sentence for one Zod issue, using the editor's field labels. */
export function describeZodIssue(issue: ZodIssue, input: unknown): string {
  const branchIssue = unionBranchIssue(issue)
  if (branchIssue) return describeZodIssue(branchIssue, input)

  const path = issue.path
  const last = String(path.at(-1) ?? '')

  if (issue.code === 'custom') {
    if (last === 'instanceCount' && path[0] === 'nodes') {
      return instanceCountWithinMax(
        labelForTopologyPath(path, input),
        labelForTopologyPath([...path.slice(0, -1), 'maxInstances'], input)
      )
    }
    return issue.message
  }

  if (issue.code === 'invalid_union') {
    const isDistribution = path.map(String).includes('distribution') || last === 'distribution'
    const label = labelForTopologyPath(path, input)
    if ((issue as { note?: string }).note === 'No matching discriminator') {
      return `${label} is not a supported option.`
    }
    return isDistribution ? `${label} must be a valid distribution.` : `${label} is not valid.`
  }

  const label = labelForTopologyPath(path, input)
  return `${label} ${describeRule(issue, valueAtPath(input, path))}.`
}

function nodeLabelAt(root: unknown, index: number): string {
  const node = asRecord(valueAtPath(root, ['nodes', index]))
  return stringValue(node?.label) ?? stringValue(node?.id) ?? `Component ${index + 1}`
}

function nodeLabelById(root: unknown, nodeId: unknown): string | undefined {
  const nodes = valueAtPath(root, ['nodes'])
  if (!Array.isArray(nodes) || typeof nodeId !== 'string') return undefined
  const index = nodes.findIndex((node) => asRecord(node)?.id === nodeId)
  return index >= 0 ? nodeLabelAt(root, index) : undefined
}

/** How a connection is named in messages: its label, else `Source -> Target`. */
export function edgeSubjectFor(root: unknown, edge: unknown, index?: number): string {
  const record = asRecord(edge)
  const label = stringValue(record?.label)
  if (label) return label
  const source = nodeLabelById(root, record?.source) ?? stringValue(record?.source)
  const target = nodeLabelById(root, record?.target) ?? stringValue(record?.target)
  if (source && target) return `${source} -> ${target}`
  return index === undefined ? 'Connection' : `Connection ${index + 1}`
}

/** What an error at `path` belongs to, as the user would name it; null means no prefix. */
export function subjectForPath(path: string, root: unknown): string | null {
  const [head, index] = splitFieldPath(path)
  const position = index !== undefined && /^\d+$/.test(index) ? Number(index) : undefined
  switch (head) {
    case 'nodes':
      return position === undefined ? null : nodeLabelAt(root, position)
    case 'edges':
      return position === undefined
        ? null
        : edgeSubjectFor(root, valueAtPath(root, ['edges', position]), position)
    case 'workload': {
      const sourceId = valueAtPath(root, ['workload', 'sourceNodeId'])
      return nodeLabelById(root, sourceId) ?? 'Workload'
    }
    case 'global':
      return 'Simulation settings'
    case 'locations': {
      if (position === undefined) return 'Locations'
      const location = asRecord(valueAtPath(root, ['locations', position]))
      return stringValue(location?.label) ?? stringValue(location?.id) ?? `Location ${position + 1}`
    }
    case 'networkModel':
      return 'Network latency settings'
    case 'faults':
      return 'Fault injection'
    case undefined:
      return null
    default:
      return 'Design'
  }
}

/** Prefixes each message with its subject (`API Server: ...`) unless it already has one. */
export function withSubjects<T extends SubjectError>(errors: readonly T[], root: unknown): T[] {
  return errors.map((error) => {
    const subject = error.subject === undefined ? subjectForPath(error.path, root) : error.subject
    if (!subject || error.message.startsWith(`${subject}: `)) {
      return { ...error, subject: subject ?? undefined }
    }
    return { ...error, subject, message: `${subject}: ${error.message}` }
  })
}

const LOCATION_KIND_NAMES: Record<string, string> = {
  region: 'region',
  'availability-zone': 'availability zone',
  subnet: 'subnet',
  'edge-pop': 'edge location'
}

/** `availability-zone` -> `an availability zone` (or `availability zone` without the article). */
export function locationKindPhrase(kind: string, withArticle = true): string {
  const name = LOCATION_KIND_NAMES[kind] ?? humanizeFieldKey(kind).toLowerCase()
  if (!withArticle) return name
  return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`
}
