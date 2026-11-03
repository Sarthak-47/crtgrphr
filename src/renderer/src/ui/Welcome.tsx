import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { loadSampleMap, newMap, openMap, openRecent, scanRepo } from '../actions/files'
import { getRecent, type RecentFile } from '../actions/recent'

const SAMPLE_BUTTONS = [
  ['webapp', 'Architecture'],
  ['deploy', 'Workflow'],
  ['cacheMiss', 'Sequence'],
  ['analytics', 'Dataflow'],
  ['agentRun', 'Lifecycle'],
] as const

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : p
}

/** First screen: get a map in front of the user in one click. */
export function Welcome() {
  const close = useStore((s) => s.setWelcomeOpen)
  const [recent, setRecent] = useState<RecentFile[]>([])

  useEffect(() => setRecent(getRecent()), [])

  // Each action closes the welcome screen first, so its dialogs aren't hidden behind it.
  const run = (fn: () => Promise<unknown>) => async () => {
    close(false)
    await fn()
  }

  return (
    <div className="cg-modal-scrim cg-welcome-scrim" onKeyDown={(e) => e.key === 'Escape' && close(false)}>
      <div className="cg-welcome" role="dialog" aria-label="Welcome" data-testid="welcome">
        <button className="cg-icon-btn cg-welcome-close" onClick={() => close(false)} aria-label="Close">✕</button>
        <div className="cg-welcome-head">
          <span className="cg-logo" aria-hidden>◆</span>
          <div>
            <h1>Cartographer</h1>
            <p>Grounded, auto-laid-out system maps. Point it at a codebase, or start from scratch.</p>
          </div>
        </div>

        <div className="cg-welcome-actions">
          <button className="cg-welcome-card primary" onClick={run(scanRepo)} autoFocus>
            <strong>Scan a repository…</strong>
            <span>Map services, packages and imports from a folder</span>
          </button>
          <button className="cg-welcome-card" onClick={run(async () => useStore.getState().setDialog('describe'))}>
            <strong>Describe your system…</strong>
            <span>Let AI draft a map from a few sentences</span>
          </button>
          <button className="cg-welcome-card" onClick={run(openMap)}>
            <strong>Open a map…</strong>
            <span>A .crtgrphr file you saved before</span>
          </button>
          <button className="cg-welcome-card" onClick={run(() => newMap())}>
            <strong>Start blank</strong>
            <span>Add nodes by hand, or import Mermaid / JSON</span>
          </button>
        </div>

        <div className="cg-welcome-cols">
          <section>
            <h2>Try a sample</h2>
            <div className="cg-welcome-samples">
              {SAMPLE_BUTTONS.map(([key, label]) => (
                <button key={key} className="cg-ghost" onClick={run(() => loadSampleMap(key))}>{label}</button>
              ))}
            </div>
          </section>
          <section>
            <h2>Recent</h2>
            {recent.length === 0 ? (
              <p className="cg-muted cg-welcome-empty">Maps you open or save will show up here.</p>
            ) : (
              <ul className="cg-recent" data-testid="recent-list">
                {recent.map((r) => (
                  <li key={r.path}>
                    <button onClick={run(() => openRecent(r.path))} title={r.path}>
                      <span className="cg-recent-title">{r.title}</span>
                      <span className="cg-recent-path">{shortPath(r.path)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
