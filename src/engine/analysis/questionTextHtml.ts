import type { QuestionPrompt } from './question'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function scaleLabel(key: string): string {
  const known: Record<string, string> = {
    dau: 'DAU',
    peakRps: 'Peak RPS',
    readWriteRatio: 'Read / Write',
    storageGb: 'Storage (GB)',
    retentionDays: 'Retention (days)',
    growthRatePercent: 'Growth rate (%)'
  }
  return (
    known[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  )
}

function scaleValue(key: string, value: number): string {
  if (key === 'readWriteRatio') return `${value}:${100 - value}`
  return new Intl.NumberFormat('en-US').format(value)
}

/** Builds the learner-facing Django HTML from structured, untrusted author text. */
export function buildQuestionTextHtml(prompt: QuestionPrompt): string {
  const sections: string[] = []
  const paragraphs = prompt.text
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  sections.push(
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
  )

  const addList = (title: string, items: string[]) => {
    if (items.length === 0) return
    sections.push(`<h3>${title}</h3>`, '<ul>')
    sections.push(...items.map((item) => `  <li>${escapeHtml(item)}</li>`))
    sections.push('</ul>')
  }

  addList('Functional Requirements', prompt.functionalRequirements)
  addList(
    'Non-Functional Targets',
    prompt.nonFunctionalRequirements.map((requirement) => requirement.description)
  )

  const scaleItems = Object.entries(prompt.scale).map(
    ([key, value]) => `<strong>${escapeHtml(scaleLabel(key))}:</strong> ${scaleValue(key, value)}`
  )
  if (scaleItems.length > 0) {
    sections.push('<h3>Scale</h3>', '<ul>')
    sections.push(...scaleItems.map((item) => `  <li>${item}</li>`))
    sections.push('</ul>')
  }
  if (prompt.additionalContext) {
    sections.push('<h3>Additional Context</h3>', `<p>${escapeHtml(prompt.additionalContext)}</p>`)
  }
  return sections.join('\n')
}
