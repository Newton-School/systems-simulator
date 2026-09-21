export type AppSurface = 'simulator' | 'question-studio'

export interface AppLocation {
  pathname: string
  search: string
}

/**
 * Question Studio is deliberately deep-link gated: normal and
 * Newton-hosted simulator URLs continue to mount the existing workspace.
 */
export function resolveAppSurface(location: AppLocation): AppSurface {
  const normalizedPath = location.pathname.replace(/\/+$/, '')
  const query = new URLSearchParams(location.search)
  return normalizedPath.endsWith('/question-studio') ||
    query.get('studio') === 'question' ||
    query.get('surface') === 'question-studio'
    ? 'question-studio'
    : 'simulator'
}

export function simulatorHrefFromLocation(location: AppLocation): string {
  const query = new URLSearchParams(location.search)
  query.delete('studio')
  query.delete('surface')
  const normalizedPath = location.pathname.replace(/\/question-studio\/?$/, '/') || '/'
  const search = query.toString()
  return `${normalizedPath}${search ? `?${search}` : ''}`
}
