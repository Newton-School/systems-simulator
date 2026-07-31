import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceLayout } from './components/layout/WorkspaceLayout'
import { installPerformanceDiagnostics } from './utils/performanceDiagnostics'

installPerformanceDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceLayout />
  </StrictMode>
)
