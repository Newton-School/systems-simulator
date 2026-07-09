import { useShallow } from 'zustand/react/shallow'
import type { ContentRoutingRule } from '../../../../engine/traits/contentRouting'
import type { AnyNodeData } from '@renderer/types/ui'
import useStore from '@renderer/store/useStore'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select } from '../ui/Select'

const MATCH_FIELDS: ContentRoutingRule['matchField'][] = ['type', 'path', 'host']

interface RoutingRulesEditorProps {
  nodeId: string
  rules: ContentRoutingRule[]
  onChange: (rules: ContentRoutingRule[]) => void
}

/**
 * ContentRoutingTrait's routingRules editor. Only ever rendered for L7 LB /
 * API Gateway / Ingress Controller (see fieldConfig.ts's supportsContentRouting)
 * - L4 never gets this section, which is the point: content routing is
 * literally unavailable at the transport layer.
 */
export const RoutingRulesEditor = ({ nodeId, rules, onChange }: RoutingRulesEditorProps) => {
  const { edges, nodes } = useStore(useShallow((s) => ({ edges: s.edges, nodes: s.nodes })))

  const targetOptions = edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => {
      const targetNode = nodes.find((node) => node.id === edge.target)
      const label = (targetNode?.data as AnyNodeData | undefined)?.label || edge.target
      return { id: edge.target, label }
    })

  const updateRule = (index: number, patch: Partial<ContentRoutingRule>) => {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
  }

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index))
  }

  const addRule = () => {
    onChange([
      ...rules,
      { matchField: 'type', matchValue: '', targetNodeId: targetOptions[0]?.id ?? '' }
    ])
  }

  return (
    <div className="mb-5" data-field-path="sim.routingRules">
      <Label>Routing Rules</Label>

      {rules.length === 0 && (
        <p className="mb-2 text-[10px] italic text-nss-muted">
          No rules - every request falls through to the default routing strategy.
        </p>
      )}

      <div className="space-y-2">
        {rules.map((rule, index) => (
          <div
            key={index}
            className="space-y-1.5 rounded border border-nss-border bg-nss-surface p-2"
          >
            <div className="grid grid-cols-2 gap-1.5">
              <Select
                value={rule.matchField}
                onChange={(event) =>
                  updateRule(index, {
                    matchField: event.target.value as ContentRoutingRule['matchField']
                  })
                }
              >
                {MATCH_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </Select>
              <Input
                type="text"
                value={rule.matchValue}
                placeholder="e.g. write"
                onChange={(event) => updateRule(index, { matchValue: event.target.value })}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Select
                className="flex-1"
                value={rule.targetNodeId}
                onChange={(event) => updateRule(index, { targetNodeId: event.target.value })}
              >
                <option value="">Select target…</option>
                {targetOptions.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => removeRule(index)}
                aria-label="Remove rule"
                className="shrink-0 rounded border border-nss-border px-2 py-2 text-xs text-nss-muted transition-colors hover:border-nss-danger hover:text-nss-danger"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRule}
        disabled={targetOptions.length === 0}
        className="mt-2 w-full rounded border border-dashed border-nss-border py-1.5 text-[11px] font-semibold text-nss-muted transition-colors hover:border-nss-primary hover:text-nss-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Add rule
      </button>
      {targetOptions.length === 0 && (
        <p className="mt-1.5 text-[10px] italic text-nss-muted">
          Connect an outgoing edge first to pick a target.
        </p>
      )}
    </div>
  )
}
