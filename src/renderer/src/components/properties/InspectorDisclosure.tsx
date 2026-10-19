import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * Simple shell's inspector section: a heading that folds its fields away. The first section
 * opens by default so a selected node shows its basics; the rest wait to be asked for.
 */
export function InspectorDisclosure({
  title,
  defaultOpen,
  children
}: {
  title: string
  defaultOpen: boolean
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-2" data-testid="inspector-disclosure">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-8 w-full items-center gap-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-nss-muted transition-colors hover:text-nss-text"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && children}
    </section>
  )
}
