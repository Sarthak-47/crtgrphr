import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './styles.css'
import { setLayoutEngine } from './layout/elk'
import { workerLayoutEngine } from './layout/worker'

// Lay maps out off the main thread. Layout runs in-process until the worker has
// answered (it never waits for it), and stays there if the worker can't start.
// Which one is in use is recorded on the page, for tests and DevTools.
document.documentElement.dataset.layout = 'in-process'
void workerLayoutEngine().then((engine) => {
  if (!engine) return
  setLayoutEngine(engine)
  document.documentElement.dataset.layout = 'worker'
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
