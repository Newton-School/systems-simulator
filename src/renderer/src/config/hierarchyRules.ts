const ROOT_PARENT = 'root'

export type AllowedParent = 'vpc-region' | 'availability-zone' | 'subnet' | typeof ROOT_PARENT

export interface HierarchyRule {
  allowedParents: readonly AllowedParent[]
  errorMessage: string
}

const DEFAULT_ALLOWED_PARENTS: readonly AllowedParent[] = [
  ROOT_PARENT,
  'vpc-region',
  'availability-zone',
  'subnet'
]

export const HIERARCHY_RULES: Record<string, HierarchyRule> = {
  'vpc-region': {
    allowedParents: [ROOT_PARENT],
    errorMessage: 'VPC Regions can only be placed on the root canvas.'
  },
  'availability-zone': {
    allowedParents: [ROOT_PARENT, 'vpc-region'],
    errorMessage: 'Availability Zones can only be placed on the root canvas or inside a VPC Region.'
  },
  subnet: {
    allowedParents: [ROOT_PARENT, 'vpc-region', 'availability-zone'],
    errorMessage:
      'Subnets can only be placed on the root canvas, inside a VPC Region, or inside an Availability Zone.'
  }
}

export function validatePlacement(
  childTemplateId?: string | null,
  parentTemplateId?: string | null
): { valid: boolean; error?: string } {
  if (!childTemplateId) return { valid: true }

  const rule = HIERARCHY_RULES[childTemplateId] ?? {
    allowedParents: DEFAULT_ALLOWED_PARENTS,
    errorMessage:
      'Resources can only be placed on the root canvas or inside a Region, Availability Zone, or Subnet.'
  }
  const targetParent = (parentTemplateId ?? ROOT_PARENT) as AllowedParent

  if (!rule.allowedParents.includes(targetParent)) {
    return { valid: false, error: rule.errorMessage }
  }

  return { valid: true }
}
