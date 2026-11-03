import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { palette } from '@shared/roles'

/** Ctrl+F: find a node by label, sublabel or id, and jump to it. */
export function SearchBox() {
  const nodes = useStore((s) => s.project.diagram.nodes)
  const theme = useStore((s) => s.theme)
  const requestFocus = useStore((s) => s.requestFocus)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => ref.current?.focus(), [])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    return nodes
      .filter((n) => n.role !== 'group')
      .map((n) => {
        const hay = [n.label, n.sublabel ?? '', n.id].map((s) => s.toLowerCase())
        const score = hay[0].startsWith(term) ? 0 : hay[0].includes(term) ? 1 : hay.some((h) => h.includes(term)) ? 2 : -1
        return { n, score }
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score || a.n.label.localeCompare(b.n.label))
      .slice(0, 8)
      .map((r) => r.n)
  }, [q, nodes])

  const close = () => setSearchOpen(false)
  const go = (i: number) => {
    const n = results[i]
    if (!n) return
    requestFocus(n.id)
    close()
  }

  return (
    <div className="cg-search" role="dialog" aria-label="Find node" data-testid="search">
      <input
        ref={ref}
        value={q}
        placeholder="Find a node…"
        aria-label="Find a node"
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'Enter') go(active)
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          }
        }}
        onBlur={() => setTimeout(close, 120)}
      />
      {q.trim() && (
        <ul>
          {results.length === 0 && <li className="cg-search-none">No matching nodes</li>}
          {results.map((n, i) => (
            <li key={n.id}>
              <button className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => go(i)}>
                <span className="cg-legend-swatch" style={{ background: palette(theme)[n.role].accent }} />
                <span className="cg-search-label">{n.label}</span>
                {n.sublabel && <span className="cg-search-sub">{n.sublabel}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
