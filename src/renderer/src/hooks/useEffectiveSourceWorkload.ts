import { useMemo } from 'react'
import type { AnyNodeData } from '@renderer/types/ui'
import useStore from '@renderer/store/useStore'
import {
  mergeWorkloadDefaults,
  type WorkloadWithoutRuntimeFields
} from '@renderer/utils/workloadDefaults'

const SOURCE_DEFAULT_WORKLOAD_PREFIX = 'source.defaultWorkload.'

type SourceNodeLike = {
  id: string
  data: Pick<AnyNodeData, 'profile'>
}

export function resolveEffectiveSelectedSourceNodeId(
  nodes: SourceNodeLike[],
  selectedSourceNodeId: string | undefined
): string | undefined {
  let firstSourceNodeId: string | undefined

  for (const node of nodes) {
    if (node.data.profile !== 'source') continue
    if (firstSourceNodeId === undefined) firstSourceNodeId = node.id
    if (selectedSourceNodeId && node.id === selectedSourceNodeId) return selectedSourceNodeId
  }

  return firstSourceNodeId
}

export function resolveDisplayedSourceWorkload(
  nodeId: string,
  data: AnyNodeData,
  effectiveSelectedSourceNodeId: string | undefined,
  workloadOverride: Partial<WorkloadWithoutRuntimeFields> | undefined
): WorkloadWithoutRuntimeFields | undefined {
  const baseWorkload = data.source?.defaultWorkload
  if (data.profile !== 'source' || !baseWorkload) {
    return undefined
  }

  if (nodeId !== effectiveSelectedSourceNodeId) {
    return baseWorkload
  }

  return mergeWorkloadDefaults(baseWorkload, workloadOverride)
}

export function withDisplayedSourceWorkload(
  data: AnyNodeData,
  displayedSourceWorkload: WorkloadWithoutRuntimeFields | undefined
): AnyNodeData {
  if (data.profile !== 'source' || !data.source || !displayedSourceWorkload) {
    return data
  }

  return {
    ...data,
    source: {
      ...data.source,
      defaultWorkload: displayedSourceWorkload
    }
  }
}

export function isSourceWorkloadFieldPath(fieldPath: string): boolean {
  return (
    fieldPath === 'source.defaultWorkload' || fieldPath.startsWith(SOURCE_DEFAULT_WORKLOAD_PREFIX)
  )
}

function omitRecordKey(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const next = { ...target }
  delete next[key]
  return next
}

function deleteNestedWorkloadOverrideValue(
  target: Record<string, unknown>,
  segments: string[]
): Record<string, unknown> {
  if (segments.length === 0) {
    return target
  }

  const [head, ...rest] = segments
  const nextValue = target[head]
  if (rest.length === 0) {
    return omitRecordKey(target, head)
  }

  if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
    return target
  }

  const nested = deleteNestedWorkloadOverrideValue(
    { ...(nextValue as Record<string, unknown>) },
    rest
  )

  if (Object.keys(nested).length === 0) {
    return omitRecordKey(target, head)
  }

  return {
    ...target,
    [head]: nested
  }
}

function setNestedWorkloadOverrideValue(
  target: Record<string, unknown>,
  segments: string[],
  value: unknown
): Record<string, unknown> {
  if (segments.length === 0) {
    return target
  }

  const [head, ...rest] = segments
  if (rest.length === 0) {
    return value === undefined
      ? deleteNestedWorkloadOverrideValue(target, [head])
      : {
          ...target,
          [head]: value
        }
  }

  const nextValue = target[head]
  const nextTarget =
    nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)
      ? { ...(nextValue as Record<string, unknown>) }
      : {}

  const nested = setNestedWorkloadOverrideValue(nextTarget, rest, value)

  if (Object.keys(nested).length === 0) {
    return omitRecordKey(target, head)
  }

  return {
    ...target,
    [head]: nested
  }
}

export function updateWorkloadOverrideForField(
  workloadOverride: Partial<WorkloadWithoutRuntimeFields> | undefined,
  fieldPath: string,
  value: unknown
): Partial<WorkloadWithoutRuntimeFields> {
  if (!isSourceWorkloadFieldPath(fieldPath)) {
    return workloadOverride ?? {}
  }

  const nestedPath = fieldPath.slice(SOURCE_DEFAULT_WORKLOAD_PREFIX.length)
  if (!nestedPath) {
    return workloadOverride ?? {}
  }

  return setNestedWorkloadOverrideValue(
    { ...((workloadOverride as Record<string, unknown> | undefined) ?? {}) },
    nestedPath.split('.'),
    value
  ) as Partial<WorkloadWithoutRuntimeFields>
}

export function useEffectiveSourceWorkload(
  nodeId: string,
  data: AnyNodeData
): WorkloadWithoutRuntimeFields | undefined {
  const workloadOverride = useStore((state) => state.scenario.workloadOverride)
  const effectiveSelectedSourceNodeId = useStore((state) =>
    resolveEffectiveSelectedSourceNodeId(
      state.nodes as SourceNodeLike[],
      state.scenario.selectedSourceNodeId
    )
  )

  return useMemo(
    () =>
      resolveDisplayedSourceWorkload(nodeId, data, effectiveSelectedSourceNodeId, workloadOverride),
    [data, effectiveSelectedSourceNodeId, nodeId, workloadOverride]
  )
}
