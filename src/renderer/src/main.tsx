import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './styles.css'
import { setLayoutEngine } from './layout/elk'
import { workerLayoutEngine } from './layout/worker'

// Lay maps out off the main thread; until the worker is confirmed, and if it
// can't start, layout runs in-process.
const engine = workerLayoutEngine()
setLayoutEngine(engine)
// Recorded on the page so tests (and anyone in DevTools) can see which one is in use.
void engine.then((e) => (document.documentElement.dataset.layout = e ? 'worker' : 'in-process'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
