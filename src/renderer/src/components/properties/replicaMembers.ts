export function parseReplicaMemberIds(value: unknown): string[] {
  if (typeof value !== 'string') return []

  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ]
}

export function serializeReplicaMemberIds(ids: readonly string[]): string | undefined {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  return unique.length > 0 ? unique.join(',') : undefined
}

export function toggleReplicaMember(
  currentIds: readonly string[],
  memberId: string,
  selected: boolean,
  requiredMemberId: string
): string[] {
  const next = new Set(currentIds)
  if (selected) next.add(memberId)
  else if (memberId !== requiredMemberId) next.delete(memberId)
  next.add(requiredMemberId)
  return [...next]
}
