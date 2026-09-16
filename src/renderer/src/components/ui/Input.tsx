import { clsx } from 'clsx'
import { EditableNumberInput } from './EditableNumberInput'

export const Input = ({
  className,
  rightElement,
  type,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { rightElement?: React.ReactNode }) => {
  const inputClassName = clsx(
    'w-full bg-nss-input-bg border border-nss-border hover:border-nss-muted/50 focus:border-nss-primary rounded px-3 py-2 text-sm text-nss-text outline-none transition-colors placeholder:text-nss-placeholder',
    className
  )

  return (
    <div className="relative group">
      {type === 'number' ? (
        <EditableNumberInput className={inputClassName} {...props} />
      ) : (
        <input type={type} className={inputClassName} {...props} />
      )}
      {rightElement && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-nss-muted text-xs pointer-events-none">
          {rightElement}
        </div>
      )}
    </div>
  )
}
