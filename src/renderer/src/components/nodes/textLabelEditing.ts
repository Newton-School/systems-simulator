export const DEFAULT_TEXT_LABEL = 'Label'
export const TEXT_LABEL_INDENT = '  '

export function normalizeTextLabelText(value: string): string {
  return value.trim().length > 0 ? value : DEFAULT_TEXT_LABEL
}

export function applyIndentCommand({
  value,
  selectionStart,
  selectionEnd,
  outdent
}: {
  value: string
  selectionStart: number
  selectionEnd: number
  outdent: boolean
}): { value: string; selectionStart: number; selectionEnd: number } {
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
  const selectionEndForLineLookup =
    selectionEnd > selectionStart && value[selectionEnd - 1] === '\n'
      ? selectionEnd - 1
      : selectionEnd
  const nextLineBreak = value.indexOf('\n', selectionEndForLineLookup)
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak
  const selectedBlock = value.slice(lineStart, lineEnd)
  const lines = selectedBlock.split('\n')

  if (!outdent) {
    const nextBlock = lines.map((line) => `${TEXT_LABEL_INDENT}${line}`).join('\n')
    const added = TEXT_LABEL_INDENT.length * lines.length

    return {
      value: `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`,
      selectionStart: selectionStart + TEXT_LABEL_INDENT.length,
      selectionEnd: selectionEnd + added
    }
  }

  let removedBeforeSelectionStart = 0
  let removedTotal = 0
  let cursor = lineStart
  const nextLines = lines.map((line) => {
    const removable = line.startsWith(TEXT_LABEL_INDENT)
      ? TEXT_LABEL_INDENT.length
      : line.startsWith(' ')
        ? 1
        : 0
    const lineOriginalStart = cursor
    cursor += line.length + 1

    if (lineOriginalStart <= selectionStart) {
      removedBeforeSelectionStart += removable
    }
    removedTotal += removable

    return removable > 0 ? line.slice(removable) : line
  })

  if (removedTotal === 0) {
    return { value, selectionStart, selectionEnd }
  }

  return {
    value: `${value.slice(0, lineStart)}${nextLines.join('\n')}${value.slice(lineEnd)}`,
    selectionStart: Math.max(lineStart, selectionStart - removedBeforeSelectionStart),
    selectionEnd: Math.max(lineStart, selectionEnd - removedTotal)
  }
}
