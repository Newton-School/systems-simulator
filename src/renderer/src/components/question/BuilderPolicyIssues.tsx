import { AlertTriangle, Lock } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { useBuilderPolicy } from '@renderer/hooks/useBuilderPolicy'
import { DEFINITIONS_LOCKED_REASON } from '../../../../engine/analysis/builderPolicy'

/**
 * Live builder-policy findings for the active question. A loaded or imported
 * design that breaks the policy is never trimmed silently: each finding is listed
 * here with its fix and a way to jump to the node. Renders nothing for questions
 * without a restrictive policy (today's behaviour).
 */
export function BuilderPolicyIssues(): React.JSX.Element | null {
  const { restrictive, locked, violations } = useBuilderPolicy()
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const requestViewportFocus = useStore((state) => state.requestViewportFocus)

  if (!restrictive || (violations.length === 0 && !locked)) return null

  return (
    <div className="space-y-2" aria-label="Builder policy">
      {locked ? (
        <p className="flex items-start gap-1.5 rounded-md border border-nss-border bg-nss-surface p-2 text-[11px] leading-snug text-nss-muted">
          <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          {DEFINITIONS_LOCKED_REASON}
        </p>
      ) : null}
      {violations.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-nss-danger/40 bg-nss-danger/10 p-3 text-[11px] leading-relaxed"
        >
          <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-nss-danger">
            <AlertTriangle size={13} aria-hidden="true" />
            Breaks this question&apos;s builder policy
          </p>
          <ul className="space-y-2 text-nss-text">
            {violations.map((violation, index) => (
              <li key={`${violation.code}-${index}`}>
                <p>{violation.message}</p>
                <p className="text-nss-muted">Fix: {violation.fix}</p>
                {violation.nodeIds.length === 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      selectGraphElements({ nodeId: violation.nodeIds[0] })
                      requestViewportFocus(violation.nodeIds)
                    }}
                    className="mt-1 text-[10px] font-semibold text-nss-primary hover:underline"
                  >
                    Show node
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
