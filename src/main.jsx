import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const redirect = sessionStorage.getItem('redirect')
sessionStorage.removeItem('redirect')
if (redirect && redirect !== window.location.href) {
  try {
    const target = new URL(redirect, window.location.origin)
    if (target.origin === window.location.origin) window.history.replaceState(null, '', target.href)
  } catch {
    // Ignore malformed redirect state.
  }
}
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
