import {
  REQUEST_MATCH_FIELDS,
  requestFieldMatches,
  type RequestMatchField
} from '../core/requestSemantics'
import type { ComponentType } from '../core/types'
import type { TraitContext } from './types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const CONTENT_ROUTING_COMPONENT_TYPES = [
  'load-balancer-l7',
  'api-gateway',
  'ingress-controller'
] as const satisfies readonly ComponentType[]

export const CONTENT_ROUTING_MATCH_FIELDS = REQUEST_MATCH_FIELDS

export type ContentRoutingMatchField = RequestMatchField

export interface ContentRoutingRule {
  matchField: ContentRoutingMatchField
  matchValue: string
  targetNodeId: string
}

export const L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE =
  'L4 operates at the transport layer and cannot inspect HTTP content. Use an L7 Load Balancer for content-based routing.'

function isContentRoutingRule(value: unknown): value is ContentRoutingRule {
  if (!value || typeof value !== 'object') {
    return false
  }
  const rule = value as Partial<ContentRoutingRule>
  return (
    typeof rule.matchField === 'string' &&
    (CONTENT_ROUTING_MATCH_FIELDS as readonly string[]).includes(rule.matchField) &&
    typeof rule.matchValue === 'string' &&
    rule.matchValue.length > 0 &&
    typeof rule.targetNodeId === 'string' &&
    rule.targetNodeId.length > 0
  )
}

export function parseRoutingRules(value: unknown): ContentRoutingRule[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isContentRoutingRule)
}

export const contentRoutingTrait: NodeBehaviourTrait = {
  name: 'routing.content',
  filterRoutes: ({ node, request, candidates }) => {
    const rules = parseRoutingRules(node.config?.['routingRules'])
    if (rules.length === 0) {
      return { routes: candidates, decision: 'no-rules-configured' }
    }

    const matchedRule = rules.find((rule) =>
      requestFieldMatches(request, rule.matchField, rule.matchValue)
    )
    if (!matchedRule) {
      return { routes: candidates, decision: 'no-rule-matched' }
    }

    const targeted = candidates.filter(
      (candidate) => candidate.targetNodeId === matchedRule.targetNodeId
    )

    if (targeted.length === 0) {
      return {
        routes: candidates,
        decision: 'matched-target-unreachable',
        payload: {
          matchField: matchedRule.matchField,
          matchValue: matchedRule.matchValue,
          targetNodeId: matchedRule.targetNodeId
        }
      }
    }

    return {
      routes: targeted,
      decision: 'content-routed',
      payload: {
        matchField: matchedRule.matchField,
        matchValue: matchedRule.matchValue,
        targetNodeId: matchedRule.targetNodeId
      }
    }
  }
}

export const contentRoutingCapabilityModule: NodeCapabilityModule = {
  name: 'routing.content',
  appliesTo: CONTENT_ROUTING_COMPONENT_TYPES,
  forbiddenOn: {
    types: ['load-balancer-l4'],
    sectionTitle: 'Content Routing',
    lockedNote: L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE
  },
  hooks: contentRoutingTrait,
  config: {
    sections: [
      {
        id: 'content-routing',
        title: 'Content Routing',
        fields: [
          {
            path: 'sim.routingRules',
            type: 'input',
            label: 'Routing rules',
            renderer: 'routing-rules',
            why: 'Routes requests by request content instead of only by generic balancing strategy.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['request matching by type, method, path, or host'],
    notModeled: ['header transforms, regex matching, SSL termination overhead']
  }
}
