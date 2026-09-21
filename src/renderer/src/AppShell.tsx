import { lazy, Suspense } from 'react'
import { resolveAppSurface, simulatorHrefFromLocation } from './appSurface'

const QuestionStudioShell = lazy(async () => {
  const module = await import('./components/authoring/QuestionStudioShell')
  return { default: module.QuestionStudioShell }
})

const WorkspaceLayout = lazy(async () => {
  const module = await import('./components/layout/WorkspaceLayout')
  return { default: module.WorkspaceLayout }
})

export function AppShell(): React.JSX.Element {
  const location = { pathname: window.location.pathname, search: window.location.search }
  if (resolveAppSurface(location) === 'question-studio') {
    return (
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-nss-bg text-sm text-nss-muted">
            Loading Question Studio…
          </div>
        }
      >
        <QuestionStudioShell simulatorHref={simulatorHrefFromLocation(location)} />
      </Suspense>
    )
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-nss-bg text-sm text-nss-muted">
          Loading simulator…
        </div>
      }
    >
      <WorkspaceLayout />
    </Suspense>
  )
}
