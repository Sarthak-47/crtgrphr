/**
 * The app's icon set: one drawing style (24-unit grid, 1.75 stroke, round caps and
 * joins), sized by the surrounding text. Decorative: the button's own text or
 * aria-label names the action.
 */
import type { ReactNode } from 'react'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="cg-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** A folder with a magnifier: read a project from disk. */
export const ScanIcon = () => (
  <Icon>
    <path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5H11" />
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h8A1.5 1.5 0 0 1 20 9.5V11" />
    <circle cx="16.5" cy="16.5" r="3" />
    <path d="m21 21-2.4-2.4" />
  </Icon>
)
export const RescanIcon = () => (
  <Icon>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 20v-4h-4" />
  </Icon>
)
/** A four-point spark: AI drafting. */
export const DescribeIcon = () => (
  <Icon>
    <path d="M12 3.5 13.8 10.2 20.5 12 13.8 13.8 12 20.5 10.2 13.8 3.5 12 10.2 10.2Z" />
    <path d="M19 3v3M17.5 4.5h3" />
  </Icon>
)
export const ImportIcon = () => (
  <Icon>
    <path d="M12 3v11" />
    <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Icon>
)
export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Icon>
)
export const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
)
export const RedoIcon = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
)
export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Icon>
)
export const MoonIcon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Icon>
)
export const ChevronIcon = () => (
  <Icon size={12}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)
export const CheckIcon = () => (
  <Icon size={14}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)
export const LayoutIcon = () => (
  <Icon>
    <rect x="3.5" y="4" width="6" height="5" rx="1" />
    <rect x="14.5" y="4" width="6" height="5" rx="1" />
    <rect x="9" y="15" width="6" height="5" rx="1" />
    <path d="M6.5 9v2.5h11V9M12 11.5V15" />
  </Icon>
)

/** Cartographer's mark: the diamond from the website and app icon. */
export const BrandMark = ({ size = 20 }: { size?: number }) => (
  <svg className="cg-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
    <path d="M16 2 30 16 16 30 2 16Z" />
    <path d="M16 9.5 22.5 16 16 22.5 9.5 16Z" />
    <path className="cg-logo-core" d="M16 13 19 16 16 19 13 16Z" />
  </svg>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)
/** A drafting pin: a part held in place while auto-layout re-flows the rest. */
export const PinIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9 3.5h6l-1 5.5 3 3H7l3-3Z" />
    <path d="M12 12v8.5" />
  </Icon>
)
export const SwapIcon = () => (
  <Icon>
    <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />
  </Icon>
)
export const ArrowUpIcon = () => (
  <Icon>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
)
export const ArrowDownIcon = () => (
  <Icon>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
)
