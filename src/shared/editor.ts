/**
 * Opening a mapped file in a code editor. Editors are reached through their URL
 * schemes (vscode://file/...), so nothing is spawned through a shell; the main
 * process accepts only the editors listed here.
 */

export const EDITORS = {
  vscode: { label: 'VS Code', scheme: 'vscode' },
  cursor: { label: 'Cursor', scheme: 'cursor' },
  vscodium: { label: 'VSCodium', scheme: 'vscodium' },
  windsurf: { label: 'Windsurf', scheme: 'windsurf' },
  system: { label: 'Default app', scheme: null },
} as const

export type EditorId = keyof typeof EDITORS

export const isEditorId = (v: unknown): v is EditorId => typeof v === 'string' && Object.hasOwn(EDITORS, v)

/** `vscode://file/D:/repo/a%20b/x.ts`: each path segment encoded, a Windows drive kept as is. */
export function editorUrl(editor: EditorId, absPath: string): string | null {
  const scheme = EDITORS[editor].scheme
  if (!scheme) return null
  const segs = absPath.replace(/\\/g, '/').split('/')
  const path = segs.map((s, i) => (i === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/')
  return `${scheme}://file${path.startsWith('/') ? '' : '/'}${path}`
}

/** The path part of a node's provenance (`k8s/app.yaml#Deployment/web`), if it names a file or folder. */
export function sourcePath(source: string): string | null {
  const path = source.split('#')[0].trim()
  if (!path || /\s/.test(path) || path.includes('..')) return null
  return path
}

/**
 * The file a link's evidence cites: evidence starts with a repo-relative path
 * (`docker-compose.yml: services.web.depends_on`, `apps/web/package.json depends on api`).
 */
export function evidencePath(evidence: string): string | null {
  const first = evidence.trim().split(/\s+/)[0]?.replace(/:$/, '') ?? ''
  if (!/[./]/.test(first) || /^[a-z]+:\/\//i.test(first)) return null
  return sourcePath(first)
}
