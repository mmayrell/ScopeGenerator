import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { StoreProvider } from './store'

// A lazy chunk can 404 when a tab from an older deploy tries to fetch assets
// that a newer deploy replaced. Reload once to pick up the current build; the
// sessionStorage guard prevents a reload loop if the chunk is genuinely broken.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('chunk-reload') === '1') return
  sessionStorage.setItem('chunk-reload', '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => {
  sessionStorage.removeItem('chunk-reload')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </StoreProvider>
  </StrictMode>,
)
