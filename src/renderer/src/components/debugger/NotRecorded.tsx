import type { ReactNode } from 'react'

/** Placeholder for a value the engine did not record - never a guessed number. */
export function NotRecorded({ children = 'not recorded' }: { children?: ReactNode }) {
  return <span className="italic text-nss-muted">{children}</span>
}
