import type { CanvasNodeDataV2 } from './nodeSpecTypes'

type SourceComponentLike = Partial<Pick<CanvasNodeDataV2, 'profile' | 'structuralRole'>>
type WorkloadSourceLike = Partial<Pick<CanvasNodeDataV2, 'source'>>

export function isSourceComponentData(
  data: SourceComponentLike | null | undefined
): boolean {
  return data?.structuralRole === 'source' || data?.profile === 'source'
}

export function hasWorkloadSourceConfig(
  data: WorkloadSourceLike | null | undefined
): data is WorkloadSourceLike & { source: NonNullable<CanvasNodeDataV2['source']> } {
  return Boolean(data?.source)
}
