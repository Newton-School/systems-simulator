import { Plus, Tag, X } from 'lucide-react'
import { useState } from 'react'
import type { QuestionDraftV1 } from '../../../../engine/analysis/questionAuthoringProject'

export type QuestionMetadata = Pick<
  QuestionDraftV1,
  'description' | 'tags' | 'author' | 'createdAt'
>

export function QuestionMetadataEditor({
  metadata,
  onChange
}: {
  metadata: QuestionMetadata
  onChange: (metadata: QuestionMetadata) => void
}): React.JSX.Element {
  const [tagInput, setTagInput] = useState('')
  const addTag = (): void => {
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (!tag || metadata.tags.includes(tag)) return
    onChange({ ...metadata, tags: [...metadata.tags, tag] })
    setTagInput('')
  }

  return (
    <section className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Tag size={16} className="text-nss-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-nss-text">Catalogue metadata</h3>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-[11px] font-semibold text-nss-text md:col-span-2">
          Short description
          <textarea
            rows={3}
            value={metadata.description ?? ''}
            onChange={(event) => onChange({ ...metadata, description: event.currentTarget.value })}
            className="mt-1.5 block w-full resize-y rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-xs font-normal leading-5 text-nss-text outline-none focus:border-nss-primary"
            placeholder="One sentence used in catalogues and assignment lists."
          />
        </label>
        <label className="text-[11px] font-semibold text-nss-text">
          Author
          <input
            value={metadata.author ?? ''}
            onChange={(event) => onChange({ ...metadata, author: event.currentTarget.value })}
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-xs font-normal text-nss-text"
            placeholder="Team or author name"
          />
        </label>
        <label className="text-[11px] font-semibold text-nss-text">
          Created date
          <input
            type="date"
            value={metadata.createdAt?.slice(0, 10) ?? ''}
            onChange={(event) =>
              onChange({
                ...metadata,
                createdAt: event.currentTarget.value
                  ? new Date(`${event.currentTarget.value}T00:00:00.000Z`).toISOString()
                  : undefined
              })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-xs font-normal text-nss-text"
          />
        </label>
      </div>
      <div className="mt-4">
        <label className="text-[11px] font-semibold text-nss-text" htmlFor="question-tag">
          Tags
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="question-tag"
            value={tagInput}
            onChange={(event) => setTagInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addTag()
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-xs text-nss-text"
            placeholder="capacity-planning"
          />
          <button
            type="button"
            onClick={addTag}
            className="flex items-center gap-1.5 rounded-md border border-nss-border px-3 py-2 text-xs font-semibold text-nss-text hover:border-nss-primary/40"
          >
            <Plus size={13} /> Add
          </button>
        </div>
        {metadata.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {metadata.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-nss-surface px-2.5 py-1 text-[10px] text-nss-text"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() =>
                    onChange({ ...metadata, tags: metadata.tags.filter((item) => item !== tag) })
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
