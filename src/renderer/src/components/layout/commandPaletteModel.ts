export interface PaletteCommand {
  id: string
  title: string
  /** Heading the command is listed under, e.g. "Run" or "Add component". */
  group: string
  /** Extra words that should find the command ("cache" finds "Distributed Cache"). */
  keywords?: string
  run: () => void
}

function score(command: PaletteCommand, tokens: readonly string[]): number | null {
  const title = command.title.toLowerCase()
  const haystack = `${title} ${command.group.toLowerCase()} ${(command.keywords ?? '').toLowerCase()}`
  let total = 0
  for (const token of tokens) {
    const at = haystack.indexOf(token)
    if (at === -1) return null
    // A match in the title beats one in the group or keywords; earlier beats later.
    total += title.includes(token)
      ? title.startsWith(token)
        ? 0
        : 10 + title.indexOf(token)
      : 100 + at
  }
  return total
}

/**
 * Commands matching every word of the query, best first. An empty query keeps the order the
 * commands were given in, so the palette opens on the most useful actions.
 */
export function filterPaletteCommands(
  commands: readonly PaletteCommand[],
  query: string
): PaletteCommand[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return [...commands]
  return commands
    .map((command, index) => ({ command, index, rank: score(command, tokens) }))
    .filter((entry): entry is { command: PaletteCommand; index: number; rank: number } => {
      return entry.rank !== null
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command)
}
