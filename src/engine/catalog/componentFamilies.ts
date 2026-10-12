/**
 * Component-type families for question grading.
 *
 * Some catalog types are a generic type plus more specific subtypes of it: a
 * Load Balancer L4 and a Load Balancer L7 are both load balancers. Wherever a
 * question matches a component type (structural rules, semantic criteria,
 * allowed / forbidden node types, rubric component counts, the learner palette),
 * matching is family-aware and DIRECTIONAL:
 *
 * - a rule naming the generic type accepts the generic type and every subtype
 *   (`load-balancer` accepts `load-balancer`, `load-balancer-l4`, `load-balancer-l7`);
 * - a rule naming a subtype accepts exactly that subtype (`load-balancer-l7`
 *   rejects the generic `load-balancer` and `load-balancer-l4`).
 *
 * Only families where the generic type is truly a superset in the catalog's own
 * semantics belong here. This is a leaf module (type imports only) so the engine,
 * the CLI and the renderer can all share it without import cycles.
 */
import type { ComponentType } from '../core/types'

interface ComponentFamilyMember {
  type: ComponentType
  /** Palette label (kept in sync with PALETTE_TEMPLATES by a test). */
  label: string
  /** Plain-words name used in learner feedback, e.g. "an L7 (HTTP / gRPC) load balancer". */
  plainName: string
}

interface ComponentFamily {
  generic: ComponentFamilyMember
  subtypes: readonly ComponentFamilyMember[]
}

export const COMPONENT_TYPE_FAMILIES: readonly ComponentFamily[] = [
  {
    generic: {
      type: 'load-balancer',
      label: 'Load Balancer',
      plainName: 'a load balancer'
    },
    subtypes: [
      {
        type: 'load-balancer-l4',
        label: 'Load Balancer L4',
        plainName: 'an L4 (TCP / UDP) load balancer'
      },
      {
        type: 'load-balancer-l7',
        label: 'Load Balancer L7',
        plainName: 'an L7 (HTTP / gRPC) load balancer'
      }
    ]
  }
]

const FAMILY_BY_GENERIC = new Map<string, ComponentFamily>(
  COMPONENT_TYPE_FAMILIES.map((family) => [family.generic.type, family])
)

const FAMILY_BY_SUBTYPE = new Map<string, ComponentFamily>(
  COMPONENT_TYPE_FAMILIES.flatMap((family) =>
    family.subtypes.map((member) => [member.type, family] as const)
  )
)

const MEMBER_BY_TYPE = new Map<string, ComponentFamilyMember>(
  COMPONENT_TYPE_FAMILIES.flatMap((family) =>
    [family.generic, ...family.subtypes].map((member) => [member.type, member] as const)
  )
)

/** Subtypes a generic type also accepts (empty for a non-generic type). */
export function componentTypeSubtypes(type: string): readonly ComponentType[] {
  return FAMILY_BY_GENERIC.get(type)?.subtypes.map((member) => member.type) ?? []
}

/** The generic type a subtype belongs to, if any. */
export function genericComponentTypeOf(type: string): ComponentType | undefined {
  return FAMILY_BY_SUBTYPE.get(type)?.generic.type
}

/** Every type a rule naming `required` accepts: itself plus its subtypes. */
export function acceptedComponentTypes(required: string): readonly string[] {
  return [required, ...componentTypeSubtypes(required)]
}

/** Whether a placed node of type `placed` satisfies a rule that names `required`. */
export function componentTypeSatisfies(placed: string, required: string): boolean {
  return placed === required || componentTypeSubtypes(required).includes(placed as ComponentType)
}

/** A type list widened so each generic entry also covers its subtypes. */
export function expandComponentTypeFamilies(types: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const type of types) {
    for (const accepted of acceptedComponentTypes(type)) out.add(accepted)
  }
  return out
}

/** Plain-words name for feedback; falls back to the raw type token. */
export function componentTypePlainName(type: string): string {
  return MEMBER_BY_TYPE.get(type)?.plainName ?? type
}

/** Palette label of a family member, or undefined outside every family. */
export function componentFamilyMemberLabel(type: string): string | undefined {
  return MEMBER_BY_TYPE.get(type)?.label
}

/**
 * Author-facing hint for a type picker: "also accepts Load Balancer L4, Load
 * Balancer L7" for a generic type, undefined otherwise.
 */
export function componentFamilyAcceptsHint(type: string): string | undefined {
  const family = FAMILY_BY_GENERIC.get(type)
  if (!family) return undefined
  return `also accepts ${family.subtypes.map((member) => member.label).join(', ')}`
}

/**
 * Feedback suffix for a check that passed only because of subtypes:
 * "satisfied by load-balancer-l7 (a load-balancer subtype)". Undefined when an
 * exact-type node is present or no subtype matched.
 */
export function describeSubtypeMatch(
  presentTypes: Iterable<string>,
  required: string
): string | undefined {
  const present = new Set(presentTypes)
  if (present.has(required)) return undefined
  const subtypes = componentTypeSubtypes(required).filter((type) => present.has(type))
  if (subtypes.length === 0) return undefined
  return subtypes.length === 1
    ? `satisfied by ${subtypes[0]} (a ${required} subtype).`
    : `satisfied by ${subtypes.join(', ')} (${required} subtypes).`
}

/**
 * Feedback for a rule naming a subtype that failed while another member of the
 * same family is present (e.g. the rule wants L7 and the learner placed the
 * generic Load Balancer or an L4): names the needed type in plain words.
 */
export function describeFamilyMismatch(
  presentTypes: Iterable<string>,
  required: string
): string | undefined {
  const family = FAMILY_BY_SUBTYPE.get(required)
  if (!family) return undefined
  const present = new Set(presentTypes)
  const relatives = [family.generic, ...family.subtypes]
    .filter((member) => member.type !== required && present.has(member.type))
    .map((member) => member.label)
  if (relatives.length === 0) return undefined
  return `${relatives.join(' and ')} ${relatives.length === 1 ? 'does' : 'do'} not count here: this check needs ${componentTypePlainName(required)} specifically (${required}).`
}
