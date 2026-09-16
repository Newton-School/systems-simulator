import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes
} from 'react'

export type EditableNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  type?: 'number'
}

function toDraftValue(value: EditableNumberInputProps['value']): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

/**
 * A controlled number input that keeps the user's text while it has focus.
 *
 * Numeric model values cannot represent the temporary empty state needed to
 * replace an existing value. Keeping that state here prevents a parent from
 * immediately rendering `0`, a minimum, or a fallback after the last digit is
 * deleted. Valid edits still reach the parent's normal onChange handler.
 */
export const EditableNumberInput = forwardRef<HTMLInputElement, EditableNumberInputProps>(
  function EditableNumberInput(
    { value, defaultValue, onChange, onFocus, onBlur, ...props },
    forwardedRef
  ) {
    const [draft, setDraft] = useState(() => toDraftValue(value ?? defaultValue))
    const isFocused = useRef(false)

    useEffect(() => {
      if (!isFocused.current) setDraft(toDraftValue(value))
    }, [value])

    const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
      isFocused.current = true
      setDraft(toDraftValue(value))
      onFocus?.(event)
    }

    const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
      isFocused.current = false
      setDraft(toDraftValue(value))
      onBlur?.(event)
    }

    return (
      <input
        {...props}
        ref={forwardedRef}
        type="number"
        value={draft}
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          onChange?.(event)
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    )
  }
)
