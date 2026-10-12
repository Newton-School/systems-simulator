import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Search,
  Upload
} from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { resolveEdgeModel } from '../../../../engine/analysis/environmentProfile'
import type { TopologyJSON } from '../../../../engine/core/types'
import { validateTopology } from '../../../../engine/validation/validator'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'
import { useTopologyJsonExport, type ExportOutcome } from '@renderer/hooks/useTopologyJsonExport'
import {
  buildTopologyTree,
  collectBranchKeys,
  filterTopologyTree,
  isEditFailure,
  leafEditor,
  pathKey,
  planTopologyEdit,
  type TreeEntry,
  type TreePath,
  type TreeRef
} from './topologyJsonTree'

interface TopologyJsonViewerProps {
  /** Opens the Import JSON dialog. Omitted where importing is not allowed. */
  onImport?: () => void
}

const DEFAULT_EXPANDED = ['nodes', 'edges', 'workload', 'global']

interface Issue {
  message: string
  tone: 'error' | 'warning'
  ref?: TreeRef
}

/** Maps a validator path (`nodes.2.queue`, `edges[1].source`) to the element it is about. */
function refForPath(path: string, topology: TopologyJSON): TreeRef | undefined {
  const match = /^(nodes|edges)[.[](\d+)/.exec(path)
  if (!match) return undefined
  const index = Number(match[2])
  if (match[1] === 'nodes') {
    const node = topology.nodes[index]
    return node ? { kind: 'node', id: node.id } : undefined
  }
  const edge = topology.edges[index]
  return edge ? { kind: 'edge', id: edge.id } : undefined
}

/**
 * JSON Topology Viewer (#87): the whole design as a structured, searchable
 * TopologyJSON tree. Simple values edit in place (the edit is applied to the
 * canvas, then the tree is re-derived); component and connection rows are
 * linked to the canvas selection in both directions.
 */
export function TopologyJsonViewer({ onImport }: TopologyJsonViewerProps) {
  const nodes = useDeferredValue(useStore((state) => state.nodes))
  const edges = useDeferredValue(useStore((state) => state.edges))
  const scenario = useStore((state) => state.scenario)
  const edgeModel = useStore((state) =>
    resolveEdgeModel(state.environmentProfile, state.activeQuestion)
  )
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const requestViewportFocus = useStore((state) => state.requestViewportFocus)
  const updateNodeData = useStore((state) => state.updateNodeData)
  const updateEdgeData = useStore((state) => state.updateEdgeData)
  const setScenario = useStore((state) => state.setScenario)
  const { copy, download } = useTopologyJsonExport()

  // The authored design, not the run input: in connector mode the run strips
  // edge physics, but the document keeps them so export -> import is lossless.
  const serialized = useMemo(
    () => serializeCanvasToTopology({ nodes, edges, scenario }, { lenient: true }),
    [edges, nodes, scenario]
  )
  const topology = serialized.topology
  const validation = useMemo(
    () => (topology ? validateTopology(topology, { edgeModel }) : null),
    [edgeModel, topology]
  )
  const tree = useMemo(() => (topology ? buildTopologyTree(topology) : []), [topology])

  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterTopologyTree(tree, query), [query, tree])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(DEFAULT_EXPANDED))
  const visibleExpanded = useMemo(
    () => (query.trim() ? new Set(collectBranchKeys(filtered)) : expanded),
    [expanded, filtered, query]
  )
  const [notice, setNotice] = useState<ExportOutcome | null>(null)
  const [editError, setEditError] = useState<{ key: string; message: string } | null>(null)

  const selectedRef = useMemo<TreeRef | null>(() => {
    const node = nodes.find((candidate) => candidate.selected)
    if (node) return { kind: 'node', id: node.id }
    const edge = edges.find((candidate) => candidate.selected)
    return edge ? { kind: 'edge', id: edge.id } : null
  }, [edges, nodes])

  // Canvas -> tree: reveal and scroll to the selected component or connection.
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRowKey = useMemo(() => {
    if (!selectedRef || !topology) return null
    const list = selectedRef.kind === 'node' ? topology.nodes : topology.edges
    const index = list.findIndex((item) => item.id === selectedRef.id)
    return index >= 0 ? pathKey([selectedRef.kind === 'node' ? 'nodes' : 'edges', index]) : null
  }, [selectedRef, topology])

  useEffect(() => {
    if (!selectedRowKey) return
    const section = selectedRowKey.split('.')[0]!
    setExpanded((current) =>
      current.has(section) && current.has(selectedRowKey)
        ? current
        : new Set([...current, section, selectedRowKey])
    )
    const handle = window.requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-tree-key="${CSS.escape(selectedRowKey)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(handle)
  }, [selectedRowKey])

  useEffect(() => {
    if (!notice) return
    const handle = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(handle)
  }, [notice])

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Tree -> canvas: select (and pan to) the element a row stands for.
  const selectRef = useCallback(
    (ref: TreeRef) => {
      if (ref.kind === 'node') {
        selectGraphElements({ nodeId: ref.id })
        requestViewportFocus([ref.id])
      } else {
        selectGraphElements({ edgeId: ref.id })
      }
    },
    [requestViewportFocus, selectGraphElements]
  )

  const commitEdit = useCallback(
    (path: TreePath, value: unknown) => {
      if (!topology) return
      const state = useStore.getState()
      const plan = planTopologyEdit(
        { nodes: state.nodes, edges: state.edges, scenario: state.scenario },
        topology,
        path,
        value
      )
      if (isEditFailure(plan)) {
        setEditError({ key: pathKey(path), message: plan.message })
        return
      }
      setEditError(null)
      if (plan.nodePatch) updateNodeData(plan.nodePatch.nodeId, plan.nodePatch.patch)
      if (plan.edgePatch) {
        updateEdgeData(plan.edgePatch.edgeId, {
          ...(plan.edgePatch.label !== undefined ? { label: plan.edgePatch.label } : {}),
          ...(plan.edgePatch.data ? { data: plan.edgePatch.data } : {})
        })
      }
      if (plan.scenario) setScenario(plan.scenario)
    },
    [setScenario, topology, updateEdgeData, updateNodeData]
  )

  const issues = useMemo<Issue[]>(() => {
    if (!topology) return []
    const list: Issue[] = serialized.errors.map((message) => ({ message, tone: 'error' }))
    for (const error of validation?.errors ?? []) {
      list.push({ message: error.message, tone: 'error', ref: refForPath(error.path, topology) })
    }
    for (const warning of validation?.warnings ?? []) {
      list.push({ message: warning, tone: 'warning' })
    }
    return list
  }, [serialized.errors, topology, validation])
  const errorCount = issues.filter((issue) => issue.tone === 'error').length
  const warningCount = issues.length - errorCount

  const runExport = async (action: () => Promise<ExportOutcome>) => setNotice(await action())

  return (
    <div className="nss-topology-json-viewer flex h-full min-h-0 flex-col border-l border-nss-border bg-nss-panel text-nss-text">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-nss-border px-3 py-2">
        <ToolbarButton
          icon={<Copy size={13} />}
          label="Copy JSON"
          onClick={() => void runExport(copy)}
          disabled={!topology}
        />
        <ToolbarButton
          icon={<Download size={13} />}
          label="Download"
          onClick={() => void runExport(download)}
          disabled={!topology}
        />
        {onImport ? (
          <ToolbarButton icon={<Upload size={13} />} label="Import" onClick={onImport} />
        ) : null}
        <span className="ml-auto">
          {topology ? <ValidityBadge errors={errorCount} warnings={warningCount} /> : null}
        </span>
      </div>

      {edgeModel === 'connector' && topology ? (
        <p className="shrink-0 border-b border-nss-border px-3 py-1.5 text-[11px] leading-4 text-nss-muted">
          Connections are plain wires in this mode: a run ignores their latency, bandwidth and error
          settings. They are kept here so the document round-trips.
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className={clsx(
            'shrink-0 border-b border-nss-border px-3 py-1.5 text-[11px]',
            notice.ok ? 'text-nss-success' : 'text-nss-warning'
          )}
        >
          {notice.message}
        </p>
      ) : null}

      {topology ? (
        <>
          <div className="shrink-0 border-b border-nss-border px-3 py-2">
            <label className="flex items-center gap-2 rounded-md border border-nss-border bg-nss-input-bg px-2 focus-within:border-nss-primary">
              <Search size={13} className="shrink-0 text-nss-muted" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search topology..."
                aria-label="Search topology"
                className="min-h-8 w-full bg-transparent text-xs text-nss-text placeholder:text-nss-muted/70 focus:outline-none"
              />
            </label>
          </div>

          <div
            ref={scrollRef}
            className="custom-scrollbar min-h-0 flex-1 overflow-auto py-1 font-mono text-[11px] leading-5"
            role="tree"
            aria-label="Topology JSON"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 font-sans text-xs text-nss-muted">
                Nothing in the topology matches &quot;{query}&quot;.
              </p>
            ) : (
              filtered.map((entry) => (
                <TreeRow
                  key={entry.key}
                  entry={entry}
                  depth={0}
                  expanded={visibleExpanded}
                  selectedKey={selectedRowKey}
                  editError={editError}
                  onToggle={toggle}
                  onSelectRef={selectRef}
                  onCommit={commitEdit}
                  onCancelEdit={() => setEditError(null)}
                />
              ))
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-nss-muted">
          <Braces size={24} className="opacity-30" />
          <p className="text-xs">Add components to see the design as TopologyJSON.</p>
        </div>
      )}

      {issues.length > 0 ? (
        <ul
          className="custom-scrollbar max-h-[30%] shrink-0 overflow-y-auto border-t border-nss-border px-3 py-2 text-[11px] leading-5"
          aria-label="Topology problems"
        >
          {issues.map((issue, index) => (
            <li key={`${index}-${issue.message}`}>
              <button
                type="button"
                disabled={!issue.ref}
                onClick={() => issue.ref && selectRef(issue.ref)}
                className={clsx(
                  'flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left',
                  issue.ref ? 'hover:bg-nss-surface' : 'cursor-default'
                )}
              >
                <AlertTriangle
                  size={12}
                  className={clsx(
                    'mt-1 shrink-0',
                    issue.tone === 'error' ? 'text-nss-danger' : 'text-nss-warning'
                  )}
                />
                <span className="text-nss-text/90">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-nss-border bg-nss-surface px-2 text-[11px] font-semibold text-nss-text transition-colors hover:border-nss-primary hover:text-nss-primary disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  )
}

function ValidityBadge({ errors, warnings }: { errors: number; warnings: number }) {
  const warningText = warnings > 0 ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''
  if (errors === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-nss-success">
        <CheckCircle2 size={13} />
        Valid{warningText}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-nss-danger">
      <AlertTriangle size={13} />
      {errors} problem{errors === 1 ? '' : 's'}
      {warningText}
    </span>
  )
}

interface TreeRowProps {
  entry: TreeEntry
  depth: number
  expanded: ReadonlySet<string>
  selectedKey: string | null
  editError: { key: string; message: string } | null
  onToggle: (key: string) => void
  onSelectRef: (ref: TreeRef) => void
  onCommit: (path: TreePath, value: unknown) => void
  onCancelEdit: () => void
}

const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const { entry, depth, expanded, selectedKey, onToggle, onSelectRef } = props
  const indent = { paddingLeft: `${8 + depth * 12}px` }

  if (entry.kind === 'leaf') {
    return <LeafRow {...props} indent={indent} />
  }

  const isOpen = expanded.has(entry.key)
  const isSelected = selectedKey === entry.key
  const Chevron = isOpen ? ChevronDown : ChevronRight

  return (
    <div role="treeitem" aria-expanded={isOpen} aria-selected={isSelected || undefined}>
      <div
        data-tree-key={entry.key}
        className={clsx(
          'group flex items-center gap-1 pr-2',
          isSelected
            ? 'bg-nss-primary/10 ring-1 ring-inset ring-nss-primary/40'
            : 'hover:bg-nss-surface'
        )}
        style={indent}
      >
        <button
          type="button"
          onClick={() => onToggle(entry.key)}
          aria-label={isOpen ? `Collapse ${entry.label}` : `Expand ${entry.label}`}
          className="flex h-5 w-4 shrink-0 items-center justify-center text-nss-muted hover:text-nss-text"
        >
          <Chevron size={12} />
        </button>
        {entry.ref ? (
          <button
            type="button"
            onClick={() => {
              onSelectRef(entry.ref!)
              if (!isOpen) onToggle(entry.key)
            }}
            title={entry.ref.kind === 'node' ? 'Select on canvas' : 'Select connection on canvas'}
            className={clsx(
              'min-w-0 max-w-[70%] shrink-0 truncate rounded px-0.5 text-left font-semibold hover:text-nss-primary hover:underline',
              isSelected ? 'text-nss-primary' : 'text-nss-text'
            )}
          >
            {entry.label}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggle(entry.key)}
            className="min-w-0 max-w-[70%] shrink-0 truncate text-left font-semibold text-nss-text"
          >
            {entry.label}
          </button>
        )}
        {entry.badge !== undefined ? (
          <span className="ml-auto shrink-0 rounded border border-nss-border px-1 font-sans text-[10px] text-nss-muted">
            {entry.badge}
          </span>
        ) : !isOpen && entry.preview ? (
          <span className="min-w-0 truncate text-nss-muted">{entry.preview}</span>
        ) : null}
      </div>
      {isOpen
        ? (entry.children ?? []).map((child) => (
            <TreeRow key={child.key} {...props} entry={child} depth={depth + 1} />
          ))
        : null}
    </div>
  )
})

function formatLeaf(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

function LeafRow({
  entry,
  editError,
  onCommit,
  onCancelEdit,
  indent
}: TreeRowProps & { indent: React.CSSProperties }) {
  const editor = leafEditor(entry.path, entry.value, entry.readOnlyReason)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const error = editError?.key === entry.key ? editError.message : draftError

  const begin = () => {
    if (editor.kind === 'readonly' || editor.kind === 'boolean') return
    setDraft(String(entry.value ?? ''))
    setDraftError(null)
    setEditing(true)
  }

  const commit = () => {
    if (editor.kind === 'number') {
      const parsed = Number(draft.trim())
      if (draft.trim() === '' || !Number.isFinite(parsed)) {
        setDraftError('Enter a number.')
        return
      }
      setEditing(false)
      if (parsed !== entry.value) onCommit(entry.path, parsed)
      return
    }
    setEditing(false)
    if (draft !== entry.value) onCommit(entry.path, draft)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(false)
      setDraftError(null)
      onCancelEdit()
    }
  }

  let valueNode: React.ReactNode
  if (editor.kind === 'boolean') {
    valueNode = (
      <input
        type="checkbox"
        checked={entry.value === true}
        onChange={(event) => onCommit(entry.path, event.target.checked)}
        aria-label={entry.label}
        className="h-3.5 w-3.5 accent-nss-primary"
      />
    )
  } else if (editing && editor.kind === 'enum') {
    valueNode = (
      <select
        autoFocus
        value={draft}
        onChange={(event) => {
          setEditing(false)
          if (event.target.value !== entry.value) onCommit(entry.path, event.target.value)
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={handleKeyDown}
        aria-label={entry.label}
        className="min-h-6 rounded border border-nss-primary bg-nss-input-bg px-1 text-[11px] text-nss-text focus:outline-none"
      >
        {editor.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  } else if (editing) {
    valueNode = (
      <input
        autoFocus
        type="text"
        inputMode={editor.kind === 'number' ? 'decimal' : undefined}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setDraftError(null)
        }}
        onFocus={(event) => event.target.select()}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        aria-label={entry.label}
        aria-invalid={draftError ? true : undefined}
        className="min-h-6 w-full min-w-0 rounded border border-nss-primary bg-nss-input-bg px-1 text-[11px] text-nss-text focus:outline-none"
      />
    )
  } else if (editor.kind === 'readonly') {
    valueNode = (
      <span title={editor.reason} className="min-w-0 truncate text-nss-muted">
        {formatLeaf(entry.value)}
      </span>
    )
  } else {
    valueNode = (
      <button
        type="button"
        onClick={begin}
        title="Click to edit"
        className={clsx(
          'min-w-0 truncate rounded px-0.5 text-left hover:bg-nss-primary/10',
          typeof entry.value === 'string' ? 'text-nss-success' : 'text-nss-primary'
        )}
      >
        {formatLeaf(entry.value)}
      </button>
    )
  }

  return (
    <div role="treeitem" aria-selected={false}>
      <div
        data-tree-key={entry.key}
        className="flex items-center gap-1.5 pr-2 hover:bg-nss-surface"
        style={{ ...indent, paddingLeft: `calc(${indent.paddingLeft} + 20px)` }}
      >
        <span className="shrink-0 text-nss-muted">{entry.label}:</span>
        {valueNode}
      </div>
      {error ? (
        <p
          role="alert"
          className="pr-2 font-sans text-[10px] text-nss-danger"
          style={{ paddingLeft: `calc(${indent.paddingLeft} + 20px)` }}
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
