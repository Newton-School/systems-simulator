import { useEffect, useState } from 'react'

const COMPACT_WORKSPACE_QUERY = '(max-width: 1180px), (max-width: 1366px) and (pointer: coarse)'

export function useCompactWorkspace(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(COMPACT_WORKSPACE_QUERY).matches
  )

  useEffect(() => {
    const query = window.matchMedia(COMPACT_WORKSPACE_QUERY)
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return compact
}

/**
 * iPad Safari can report a CSS viewport taller than the currently visible area
 * while its browser bars are expanded. Keep the workspace pinned to the visual
 * viewport so the document never becomes the scroll container.
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const height = window.visualViewport?.height ?? window.innerHeight
        document.documentElement.style.setProperty('--nss-app-height', `${Math.round(height)}px`)
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty('--nss-app-height')
    }
  }, [])
}
