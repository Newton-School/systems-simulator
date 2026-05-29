import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { WorkspaceLayout } from './components/layout/WorkspaceLayout'
import useStore from './store/useStore'

window.addEventListener('beforeunload', (event) => {
  const isUnsaved = useStore.getState().isUnsaved

  if (!isUnsaved) return

  event.preventDefault()
  event.returnValue = ''
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceLayout />
  </StrictMode>
)
