/**
 * Produces the default package identifier shown by Question Studio and used by
 * the Newton row adapter when an explicit question ID is absent.
 *
 * Keep this pure and deterministic: authoring UI previews and exported runtime
 * rows must derive the same ID from the same title.
 */
export function deriveQuestionIdFromTitle(title: string): string {
  const derivedId = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return derivedId || 'untitled-question'
}
