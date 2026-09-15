export interface CanvasLegendItem {
  label: string
  swatchClassName: string
  shape: 'dot' | 'square'
  /** When set, the item renders this glyph instead of a color swatch. */
  glyph?: string
}

export interface CanvasLegendSection {
  title: string
  items: CanvasLegendItem[]
}

export const CANVAS_RUNTIME_LEGEND_SECTIONS: CanvasLegendSection[] = [
  {
    title: 'Reliability',
    items: [
      { label: 'Healthy', swatchClassName: 'bg-nss-success', shape: 'dot' },
      { label: 'Degraded', swatchClassName: 'bg-nss-warning', shape: 'dot' },
      { label: 'Failing', swatchClassName: 'bg-nss-danger', shape: 'dot' },
      { label: 'Idle', swatchClassName: 'bg-nss-muted', shape: 'dot' }
    ]
  },
  {
    title: 'Capacity',
    items: [
      { label: 'Headroom', swatchClassName: 'bg-nss-success', shape: 'square' },
      { label: 'Steady', swatchClassName: 'bg-nss-primary', shape: 'square' },
      { label: 'Tight', swatchClassName: 'bg-nss-warning', shape: 'square' },
      { label: 'Saturated', swatchClassName: 'bg-orange-400', shape: 'square' }
    ]
  },
  {
    title: 'Path',
    items: [
      { label: 'Moving requests', swatchClassName: 'bg-nss-success', shape: 'dot' },
      { label: 'Elevated failures', swatchClassName: 'bg-nss-warning', shape: 'dot' },
      { label: 'Hard failures', swatchClassName: 'bg-nss-danger', shape: 'dot' }
    ]
  },
  {
    title: 'Distribution',
    items: [
      { label: 'Thicker edge = more traffic', swatchClassName: 'bg-nss-muted', shape: 'square' },
      {
        label: 'Slower dots = higher latency or backpressure',
        swatchClassName: 'bg-nss-muted',
        shape: 'dot'
      },
      { label: 'Edge % = weighted share', swatchClassName: '', shape: 'dot', glyph: '%' },
      {
        label: 'Dot color = request key (toggle in Display)',
        swatchClassName: '',
        shape: 'dot',
        glyph: '🎨'
      }
    ]
  },
  {
    title: 'Node effects',
    items: [
      { label: 'Cache hit (dot bounces back)', swatchClassName: 'bg-nss-primary', shape: 'dot' },
      { label: 'Cache short-circuit', swatchClassName: '', shape: 'dot', glyph: '⚡' },
      { label: 'Retries', swatchClassName: '', shape: 'dot', glyph: '↻' },
      { label: 'Replicated write', swatchClassName: '', shape: 'dot', glyph: '⇉' },
      { label: 'Scatter / gather', swatchClassName: '', shape: 'dot', glyph: '⋔' },
      { label: 'Duplicates blocked', swatchClassName: '', shape: 'dot', glyph: '⊘' }
    ]
  }
]

export const CANVAS_PRE_RUN_LEGEND_NOTE =
  'Run a simulation to populate reliability, capacity, and path indicators.'
