import type { ComponentType } from '../core/types'

export type CustomDefinitionKind = 'service' | 'custom-node'

export type RuntimeTemplateId =
  | 'long-running-service'
  | 'serverless-function'
  | 'background-worker'
  | 'external-dependency'

export type DependencyAction = 'read' | 'write' | 'publish' | 'invoke' | 'enqueue'

export interface CustomDependencyIntent {
  target: string
  action: DependencyAction
  condition?: 'always' | 'cache-miss'
}

export interface CustomOperationDefinition {
  id: string
  requestType: string
  responseType: string
  dependencies: CustomDependencyIntent[]
}

export interface CustomNodeDefinition {
  kind: CustomDefinitionKind
  runtimeTemplate: RuntimeTemplateId
  description?: string
  operations: CustomOperationDefinition[]
}

export interface RuntimeTemplateDefinition {
  id: RuntimeTemplateId
  label: string
  componentType: ComponentType
  paletteTemplateId: string
  simulates: readonly string[]
  notModeled: readonly string[]
}

export const RUNTIME_TEMPLATES: Record<RuntimeTemplateId, RuntimeTemplateDefinition> = {
  'long-running-service': {
    id: 'long-running-service',
    label: 'Long-running service',
    componentType: 'microservice',
    paletteTemplateId: 'backend-server',
    simulates: ['queueing', 'resource-derived concurrency', 'timeouts and retries'],
    notModeled: ['user-written application code']
  },
  'serverless-function': {
    id: 'serverless-function',
    label: 'Serverless function',
    componentType: 'serverless-function',
    paletteTemplateId: 'lambda-function',
    simulates: ['cold starts', 'idle windows', 'concurrency throttling'],
    notModeled: ['provider-exact quotas and billing']
  },
  'background-worker': {
    id: 'background-worker',
    label: 'Background worker',
    componentType: 'batch-worker',
    paletteTemplateId: 'async-worker',
    simulates: ['queueing', 'asynchronous processing', 'worker capacity'],
    notModeled: ['arbitrary job code']
  },
  'external-dependency': {
    id: 'external-dependency',
    label: 'External dependency',
    componentType: 'third-party-api-connector',
    paletteTemplateId: 'external-service',
    simulates: ['external latency', 'error rate', 'timeouts'],
    notModeled: ['the provider implementation']
  }
}

export function templateForDefinition(definition: CustomNodeDefinition): RuntimeTemplateDefinition {
  return RUNTIME_TEMPLATES[definition.runtimeTemplate]
}

export function isCustomNodeDefinition(value: unknown): value is CustomNodeDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CustomNodeDefinition>
  return (
    (candidate.kind === 'service' || candidate.kind === 'custom-node') &&
    typeof candidate.runtimeTemplate === 'string' &&
    candidate.runtimeTemplate in RUNTIME_TEMPLATES &&
    Array.isArray(candidate.operations)
  )
}

export function serviceRecipe(
  recipe: 'blank' | 'auth' | 'url-shortener'
): CustomOperationDefinition[] {
  if (recipe === 'auth') {
    return [
      { id: 'authenticate', requestType: 'authenticate', responseType: 'token', dependencies: [] }
    ]
  }
  if (recipe === 'url-shortener') {
    return [
      {
        id: 'create',
        requestType: 'create-short-url',
        responseType: 'short-url-created',
        dependencies: [{ target: 'URL Mapping DB', action: 'write', condition: 'always' }]
      },
      {
        id: 'resolve',
        requestType: 'resolve-short-url',
        responseType: 'redirect',
        dependencies: [
          { target: 'URL Cache', action: 'read', condition: 'always' },
          { target: 'URL Mapping DB', action: 'read', condition: 'cache-miss' }
        ]
      }
    ]
  }
  return [{ id: 'handle', requestType: 'request', responseType: 'response', dependencies: [] }]
}
