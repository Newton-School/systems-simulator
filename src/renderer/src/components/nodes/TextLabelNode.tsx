import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { NodeProps } from 'reactflow'
import { clsx } from 'clsx'
import type { CanvasTextLabelData } from '../../../../engine/catalog/canvasAnnotations'
import { useFlowStore } from '../canvas/hooks/useFlowStore'

const DEFAULT_LABEL_TEXT = 'Label'

const TextLabelNode = ({ id, data, selected }: NodeProps<CanvasTextLabelData>) => {
  const { updateNodeData } = useFlowStore()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(data.text || DEFAULT_LABEL_TEXT)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(data.text || DEFAULT_LABEL_TEXT)
  }, [data.text])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const save = () => {
    const nextText = draft.trim() || DEFAULT_LABEL_TEXT
    setIsEditing(false)
    setDraft(nextText)
    updateNodeData(id, { text: nextText })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(data.text || DEFAULT_LABEL_TEXT)
      setIsEditing(false)
    }
  }

  return (
    <div
      className={clsx(
        'canvas-text-label group min-w-24 max-w-72 rounded-md border bg-nss-panel/90 px-2 py-1 shadow-lg backdrop-blur transition-all',
        selected && 'canvas-text-label--selected ring-2 ring-nss-primary/40'
      )}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setIsEditing(true)
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          onClick={(event) => event.stopPropagation()}
          className="nodrag w-full min-w-24 bg-transparent text-sm font-semibold leading-tight text-nss-text outline-none"
        />
      ) : (
        <span
          title="Double click to edit"
          className="block max-w-64 cursor-text truncate text-sm font-semibold leading-tight text-nss-text"
        >
          {data.text || DEFAULT_LABEL_TEXT}
        </span>
      )}
    </div>
  )
}

export default memo(TextLabelNode)
