import type { SimulationOutput } from '../../../../engine/analysis/output'

type ConsistencyReport = NonNullable<SimulationOutput['consistency']>

/**
 * Warn only when a datastore broke the guarantee its own model promises. Stale
 * reads under eventual consistency (or from another session under
 * read-your-writes) are the expected trade-off of that choice, not a fault.
 */
export function consistencyLevel(report: ConsistencyReport): 'healthy' | 'warnings' {
  const promises = (...models: string[]) => report.nodes.some((node) => models.includes(node.model))
  const strongStale = report.nodes
    .filter((node) => node.model === 'strong')
    .some((node) => node.staleReads > 0)
  return strongStale ||
    (report.readYourWritesViolations > 0 && promises('read-your-writes', 'strong')) ||
    (report.monotonicReadViolations > 0 && promises('monotonic-reads', 'strong')) ||
    (report.linearizability.keysViolating > 0 && promises('strong'))
    ? 'warnings'
    : 'healthy'
}
