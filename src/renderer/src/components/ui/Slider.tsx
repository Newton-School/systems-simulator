import type { CSSProperties, ChangeEvent } from 'react'

export const Slider = ({
  value,
  min = 0,
  max = 100,
  unit,
  onChange
}: {
  value: number
  min?: number
  max?: number
  unit?: string
  onChange: (val: number) => void
}) => {
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    let newValue = Number(e.target.value)

    // Safety check to keep values within bounds while typing
    if (newValue > max) newValue = max
    if (newValue < min) newValue = min

    onChange(newValue)
  }

  const dynamicWidth = `${Math.max(3, String(value).length + 2)}ch`
  const sliderProgress = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div className="bg-nss-surface border border-nss-border rounded p-3 group hover:border-nss-border-high transition-colors">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-nss-muted font-medium select-none">{unit}</span>

        {/* --- AUTO-RESIZING INPUT --- */}
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={handleInputChange}
          style={{ width: dynamicWidth }}
          className="
            text-center text-xs tabular-nums
            bg-nss-primary/10 text-nss-primary 
            border border-nss-primary/20 rounded px-1 py-0.5
            focus:outline-none focus:border-nss-primary focus:ring-1 focus:ring-nss-primary/50
            transition-all duration-100 ease-in-out
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
          "
        />
      </div>

      {/* --- SLIDER TRACK --- */}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="nss-range w-full"
        style={{ '--range-progress': `${sliderProgress}%` } as CSSProperties}
      />
    </div>
  )
}
