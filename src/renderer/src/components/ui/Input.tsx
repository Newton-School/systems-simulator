import { clsx } from 'clsx'

export const Input = ({
  className,
  rightElement,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { rightElement?: React.ReactNode }) => (
  <div className="relative group">
    <input
      className={clsx(
        'w-full bg-nss-input-bg border border-nss-border hover:border-nss-muted/50 focus:border-nss-primary rounded px-3 py-2 text-sm text-nss-text outline-none transition-colors placeholder:text-nss-placeholder',
        className
      )}
      {...props}
    />
    {rightElement && (
      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-nss-muted text-xs pointer-events-none">
        {rightElement}
      </div>
    )}
  </div>
)
