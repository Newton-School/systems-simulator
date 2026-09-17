interface ToggleButtonProps {
  onClick: () => void
  isOpen: boolean
  icon: React.ReactNode
  label: string
}

export const ToggleButton = ({ onClick, isOpen, icon, label }: ToggleButtonProps) => {
  const baseClass =
    'nss-touch-target p-2 rounded transition-colors duration-200 flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-nss-primary'
  const activeClass = 'bg-nss-border text-nss-primary'
  const inactiveClass = 'text-nss-muted hover:bg-nss-surface hover:text-nss-text'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={isOpen}
      className={`${baseClass} ${isOpen ? activeClass : inactiveClass}`}
    >
      <span aria-hidden="true" className="flex items-center justify-center">
        {icon}
      </span>
    </button>
  )
}
