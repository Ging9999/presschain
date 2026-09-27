import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installDevMockIfNeeded } from './lib/devMock'

// Dev-only: provide a mock window.api when running outside Electron (no preload).
installDevMockIfNeeded()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
