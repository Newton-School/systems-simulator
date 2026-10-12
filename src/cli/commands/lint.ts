import type { TopologyJSON } from '../../engine/core/types'
import { detectAntiPatterns, type AntiPatternWarning } from '../../engine/analysis/antiPatterns'
import type { Palette } from '../../shared/ansi'
import { CLI_EXIT_CHECK_FAILED, CLI_EXIT_SUCCESS } from '../exitCodes'

export interface LintReport {
  topologyId: string
  topologyName: string
  /** Architectural anti-patterns (`detectAntiPatterns`), critical first. */
  antiPatterns: AntiPatternWarning[]
  /** Non-fatal schema/config warnings from `validateTopology`. */
  validationWarnings: string[]
  summary: {
    critical: number
    warnings: number
    validationWarnings: number
  }
  /** False when any critical anti-pattern was found (the command then exits 2). */
  passed: boolean
}

export function buildLintReport(topology: TopologyJSON, validationWarnings: string[]): LintReport {
  const antiPatterns = detectAntiPatterns(topology)
  const critical = antiPatterns.filter((w) => w.severity === 'critical').length
  return {
    topologyId: topology.id,
    topologyName: topology.name,
    antiPatterns,
    validationWarnings: [...validationWarnings],
    summary: {
      critical,
      warnings: antiPatterns.length - critical,
      validationWarnings: validationWarnings.length
    },
    passed: critical === 0
  }
}

export function lintExitCode(report: LintReport): number {
  return report.passed ? CLI_EXIT_SUCCESS : CLI_EXIT_CHECK_FAILED
}

export function formatLintReport(report: LintReport, topology: TopologyJSON, c: Palette): string {
  const labelOf = new Map(topology.nodes.map((node) => [node.id, node.label || node.id]))
  const lines: string[] = []
  lines.push(
    `${c.bold}Lint${c.reset} ${c.dim}${report.topologyName} (${report.topologyId})${c.reset}`
  )
  lines.push('')

  if (report.antiPatterns.length === 0) {
    lines.push(`${c.green}No architectural anti-patterns found.${c.reset}`)
  }
  for (const finding of report.antiPatterns) {
    const sev =
      finding.severity === 'critical'
        ? `${c.red}${c.bold}CRITICAL${c.reset}`
        : `${c.yellow}WARNING${c.reset}`
    lines.push(`[${sev}] ${c.bold}${finding.title}${c.reset} ${c.dim}(${finding.rule})${c.reset}`)
    lines.push(`  ${finding.message}`)
    if (finding.nodeIds.length > 0) {
      const nodes = finding.nodeIds.map((id) => {
        const label = labelOf.get(id)
        return label && label !== id ? `${label} [${id}]` : id
      })
      lines.push(`  ${c.dim}Nodes:${c.reset} ${nodes.join(', ')}`)
    }
    if (finding.edgeIds.length > 0) {
      lines.push(`  ${c.dim}Edges:${c.reset} ${finding.edgeIds.join(', ')}`)
    }
    lines.push(`  ${c.cyan}Fix:${c.reset} ${finding.recommendation}`)
    lines.push('')
  }

  if (report.validationWarnings.length > 0) {
    if (report.antiPatterns.length === 0) lines.push('')
    lines.push(`${c.bold}Validation warnings${c.reset}`)
    for (const warning of report.validationWarnings) {
      lines.push(`  ${c.yellow}-${c.reset} ${warning}`)
    }
    lines.push('')
  }

  const { critical, warnings, validationWarnings } = report.summary
  const verdict = report.passed ? `${c.green}PASS${c.reset}` : `${c.red}${c.bold}FAIL${c.reset}`
  lines.push(
    `${verdict} ${critical} critical, ${warnings} warning${warnings === 1 ? '' : 's'}, ` +
      `${validationWarnings} validation warning${validationWarnings === 1 ? '' : 's'}`
  )
  return lines.join('\n')
}
