import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { NodeProps } from 'reactflow'
import { clsx } from 'clsx'
import type { CanvasTextLabelData } from '../../../../engine/catalog/canvasAnnotations'
import { useFlowStore } from '../canvas/hooks/useFlowStore'
import { applyIndentCommand, DEFAULT_TEXT_LABEL, normalizeTextLabelText } from './textLabelEditing'

const MIN_LABEL_WIDTH_CLASS = 'min-w-24'
const MAX_LABEL_WIDTH_CLASS = 'max-w-80'

const TextLabelNode = ({ id, data, selected }: NodeProps<CanvasTextLabelData>) => {
  const { updateNodeData } = useFlowStore()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(data.text || DEFAULT_TEXT_LABEL)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(data.text || DEFAULT_TEXT_LABEL)
  }, [data.text])

  useEffect(() => {
    if (!isEditing) return
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }, [isEditing])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft, isEditing])

  const save = () => {
    const nextText = normalizeTextLabelText(draft)
    setIsEditing(false)
    setDraft(nextText)
    updateNodeData(id, { text: nextText })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()

    if (event.key === 'Tab') {
      event.preventDefault()
      const textarea = event.currentTarget
      const next = applyIndentCommand({
        value: textarea.value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        outdent: event.shiftKey
      })
      setDraft(next.value)
      window.requestAnimationFrame(() => {
        textarea.setSelectionRange(next.selectionStart, next.selectionEnd)
      })
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(data.text || DEFAULT_TEXT_LABEL)
      setIsEditing(false)
    }
  }

  return (
    <div
      className={clsx(
        'group rounded-md px-1 py-0.5 text-nss-muted transition-all',
        MIN_LABEL_WIDTH_CLASS,
        MAX_LABEL_WIDTH_CLASS,
        selected && 'ring-1 ring-nss-primary/45'
      )}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setIsEditing(true)
      }}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDownCapture={handleKeyDown}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          rows={1}
          spellCheck={false}
          className={clsx(
            'nodrag nopan block w-full resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent p-0 font-mono text-sm font-semibold leading-snug text-current caret-nss-muted outline-none',
            MIN_LABEL_WIDTH_CLASS,
            MAX_LABEL_WIDTH_CLASS
          )}
        />
      ) : (
        <span
          title="Double click to edit"
          className={clsx(
            'block cursor-text whitespace-pre-wrap break-words font-mono text-sm font-semibold leading-snug text-current',
            MAX_LABEL_WIDTH_CLASS
          )}
        >
          {data.text || DEFAULT_TEXT_LABEL}
        </span>
      )}
    </div>
  )
}

export default memo(TextLabelNode)
