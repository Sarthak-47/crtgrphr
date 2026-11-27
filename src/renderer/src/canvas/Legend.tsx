import { useMemo } from 'react'
import { useStore } from '../state/store'
import { palette } from '@shared/roles'
import { INFERRED_LABEL, legendContent, VARIANT_LABEL } from '../render/legend'
import { ChevronIcon } from '../ui/icons'

/** Floating, collapsible key to the roles and edge styles this map uses. */
export function Legend() {
  const diagram = useStore((s) => s.project.diagram)
  const theme = useStore((s) => s.theme)
  const open = useStore((s) => s.legendOpen)
  const toggle = useStore((s) => s.toggleLegend)
  const { roles, variants, inferred } = useMemo(() => legendContent(diagram), [diagram])
  if (roles.length === 0) return null
  const pal = palette(theme)
  const stroke = theme === 'dark' ? '#94a3b8' : '#64748b'

  return (
    <div className={`cg-canvas-legend${open ? '' : ' collapsed'}`} data-testid="legend">
      <button className="cg-legend-toggle" onClick={toggle} aria-expanded={open}>
        Legend <span className={`cg-legend-chev${open ? ' is-open' : ''}`}><ChevronIcon /></span>
      </button>
      {open && (
        <>
          <div className="cg-legend-rows">
            {roles.map((r) => (
              <span key={r} className="cg-legend-item">
                <span className="cg-legend-swatch" style={{ background: pal[r].accent }} />
                {pal[r].label}
              </span>
            ))}
          </div>
          {(variants.length > 1 || inferred) && (
            <div className="cg-legend-rows">
              {variants.map((v) => (
                <span key={v} className="cg-legend-item">
                  <svg width="22" height="8" aria-hidden>
                    <line
                      x1="1"
                      y1="4"
                      x2="21"
                      y2="4"
                      stroke={stroke}
                      strokeWidth={v === 'emphasis' ? 2.4 : v === 'weak' ? 1.2 : 1.6}
                      strokeDasharray={v === 'dashed' ? '4 3' : undefined}
                    />
                  </svg>
                  {VARIANT_LABEL[v]}
                </span>
              ))}
              {inferred && (
                <span className="cg-legend-item" title="Found from hints such as a hostname in an environment variable or a client library, not from an explicit declaration. Select the link to see the evidence.">
                  <em>{INFERRED_LABEL}</em>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
