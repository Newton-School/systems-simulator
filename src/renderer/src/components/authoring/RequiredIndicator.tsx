interface RequiredIndicatorProps {
  className?: string
}

export function RequiredIndicator({ className = '' }: RequiredIndicatorProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      title="Required"
      className={`ml-0.5 font-semibold text-nss-danger ${className}`}
    >
      *
    </span>
  )
}
