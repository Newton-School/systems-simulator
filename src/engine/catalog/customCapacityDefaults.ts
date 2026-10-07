import type { WorkloadKind } from '../core/types'
import { RUNTIME_TEMPLATES, type RuntimeTemplateId } from './customDefinitions'
import { instantiateTemplate } from './paletteTemplates'
import { getResourceDefaults } from './resourceDefaults'

export interface CapacityTraitDefaults {
  workloadKind: WorkloadKind
  instanceCount: number
  workersPerInstance: number
  queueSlots: number
}

/**
 * The capacity values a custom node ends up with when its capacity trait fields are
 * left unset. `applyDefinitionTraits` only writes fields the author set, so the
 * seeded resources of the runtime template's palette node win - the builder must
 * display these (not a hard-coded fallback) or it shows a value the node never gets.
 * Lives outside customDefinitions.ts because paletteTemplates → componentSpecs →
 * customDefinitions would otherwise form an import cycle.
 */
export function resolveCapacityTraitDefaults(
  runtimeTemplate: RuntimeTemplateId
): CapacityTraitDefaults {
  const template = RUNTIME_TEMPLATES[runtimeTemplate]
  const typeDefaults = getResourceDefaults(template.componentType)
  const seeded = instantiateTemplate(template.paletteTemplateId).sim?.resources
  return {
    workloadKind: seeded?.workloadKind ?? typeDefaults.workloadKind,
    instanceCount: seeded?.instanceCount ?? 1,
    workersPerInstance: seeded?.workersPerInstance ?? typeDefaults.workersPerInstance,
    queueSlots: seeded?.queueSlots ?? typeDefaults.queueSlots
  }
}
