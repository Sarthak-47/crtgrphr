/**
 * Cartographer CLI: scan a repository into a map, keep a committed map up to
 * date, check it for drift in CI, and export it. Pure Node (no Electron): it runs
 * the same scanner, layout engine, diff and exporters as the desktop app.
 *
 *   crtgrphr scan   [dir] [--out map.crtgrphr] [exports...]
 *   crtgrphr check  [dir] --map map.crtgrphr [--report drift.md]
 *   crtgrphr export <map.crtgrphr> [exports...]
 *
 * Exit codes: 0 ok, 1 the map has drifted (check), 2 usage or runtime error.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { scanRepositoryWithReport, type ScanOptions } from '../main/repo-scan'
import { applyRescan, diffDiagrams, diffIsEmpty, diffSummary, type DiagramDiff } from '../shared/diff'
import { parseProject, serializeProject } from '../shared/serialize'
import { emptyProject, type CartographProject, type IRDiagram } from '../shared/ir'
import { visibleDiagram, visibleIdMap } from '../shared/collapse'
import { applyView, findView } from '../shared/views'
import { layoutDiagram } from '../renderer/src/layout'
import { mergeOverrides } from '../renderer/src/layout/elk'
import { diagramToSvg } from '../renderer/src/export/svg'
import { diagramToMermaid, driftToMermaid, type DriftKind } from '../renderer/src/adapters/mermaid-export'
import { diagramToDrawio } from '../renderer/src/export/drawio'
import { diagramToC4PlantUml } from '../renderer/src/adapters/c4-export'

declare const __CRTGRPHR_VERSION__: string
const VERSION = typeof __CRTGRPHR_VERSION__ === 'string' ? __CRTGRPHR_VERSION__ : 'dev'

const HELP = `Cartographer ${VERSION}: system maps from code.

Usage
  crtgrphr scan [dir] [options]       Scan a repository. With --out, writes the map
                                      (an existing map is updated: your edits, pins
                                      and hand-added parts are kept).
  crtgrphr check [dir] --map <file>   Compare a committed map with the code. Exits 1
                                      if the code has changed since the map was made.
  crtgrphr export <file> [options]    Export a saved map.

Options
  --out, -o <file>     map file to write (scan)
  --map, -m <file>     map file to check (check)
  --mermaid <file>     also write Mermaid (.mmd, or .md for a fenced block)
  --svg <file>         also write an SVG image
  --drawio <file>      also write a draw.io file
  --c4 <file>          also write a C4 container diagram (C4-PlantUML)
  --theme light|dark   SVG theme (default light)
  --view <name>        export a saved view of the map (its groups collapsed as
                       saved in the app); the map file itself is unchanged
  --report <file>      check: write a Markdown drift report
  --update             check: if the map has drifted, update it (and its exports)
  --strict             check: also fail on detail changes (sublabels such as file
                       counts, edge labels such as import counts); by default only
                       structure counts: parts and links added or removed, and
                       parts renamed or changing kind
  --helm               render Helm charts with the local helm binary (helm template;
                       nothing is downloaded), so the map shows the workloads they
                       deploy. Use it for scan and check alike.
  --quiet, -q          print only errors
  --version, -v        print the version
  --help, -h           show this help

Exit codes: 0 ok, 1 drift found (check), 2 error.
`

interface Options {
  cmd: string
  positional: string[]
  out?: string
  map?: string
  mermaid?: string
  svg?: string
  drawio?: string
  c4?: string
  theme: 'light' | 'dark'
  view?: string
  report?: string
  update: boolean
  strict: boolean
  helm: boolean
  quiet: boolean
}

class UsageError extends Error {}

export function parseArgs(argv: string[]): Options {
  const o: Options = { cmd: '', positional: [], theme: 'light', update: false, strict: false, helm: false, quiet: false }
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('-')) throw new UsageError(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
    const take = (): string => {
      if (inline !== undefined) return inline
      const v = value(i, flag)
      i++
      return v
    }
    switch (flag) {
      case '--out': case '-o': o.out = take(); break
      case '--map': case '-m': o.map = take(); break
      case '--mermaid': o.mermaid = take(); break
      case '--svg': o.svg = take(); break
      case '--drawio': o.drawio = take(); break
      case '--c4': o.c4 = take(); break
      case '--view': o.view = take(); break
      case '--report': o.report = take(); break
      case '--theme': {
        const t = take()
        if (t !== 'light' && t !== 'dark') throw new UsageError('--theme must be light or dark')
        o.theme = t
        break
      }
      case '--update': o.update = true; break
      case '--strict': o.strict = true; break
      case '--helm': o.helm = true; break
      case '--quiet': case '-q': o.quiet = true; break
      case '--help': case '-h': o.cmd = 'help'; break
      case '--version': case '-v': o.cmd = o.cmd || 'version'; break
      default:
        if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`)
        if (!o.cmd) o.cmd = a
        else o.positional.push(a)
    }
  }
  return o
}

const posix = (p: string): string => p.split(sep).join('/')

async function writeOut(path: string, text: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true })
  await writeFile(path, text, 'utf8')
}

async function loadMap(path: string): Promise<CartographProject> {
  const abs = resolve(path)
  try {
    const text = await readFile(abs, 'utf8')
    return parseProject(text, { filePath: abs }).value
  } catch (e) {
    throw new Error(`${posix(path)}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Scan a folder, turning "not found" and "not a folder" into plain messages. */
async function scanFolder(dir: string, hint = '', opts: ScanOptions = {}): Promise<IRDiagram> {
  let info
  try {
    info = await stat(dir)
  } catch {
    throw new Error(`folder not found: ${posix(dir)}${hint}`)
  }
  if (!info.isDirectory()) throw new Error(`not a folder: ${posix(dir)}${hint}`)
  const { diagram, warnings } = await scanRepositoryWithReport(dir, opts)
  // What the scan skipped goes to stderr, so piping the map (scan with no --out) stays clean.
  for (const w of warnings) notes(`note: ${w}`)
  return diagram
}

let notes: (s: string) => void = () => {}

/** Lay the map out (pins respected) and fold the result into its layout layer. */
async function laidOut(project: CartographProject) {
  const view = visibleDiagram(project.diagram)
  const laid = await layoutDiagram(view, project.layout)
  const hidden = new Set(visibleIdMap(project.diagram).keys())
  const layout = project.diagram.type === 'sequence' ? {} : mergeOverrides(laid, project.layout, hidden)
  return { view, laid, project: { ...project, layout } }
}

/** The project as a saved view shows it (for exports). */
function withView(project: CartographProject, name: string): CartographProject {
  const v = findView(project.views, name)
  if (!v) {
    const names = (project.views ?? []).map((x) => `"${x.name}"`).join(', ')
    throw new Error(`no view named "${name}" in the map${names ? ` (it has ${names})` : ' (save one in the app first)'}`)
  }
  return { ...project, diagram: applyView(project.diagram, v) }
}

async function writeExports(o: Options, project: CartographProject, log: (s: string) => void): Promise<CartographProject> {
  const hasExports = !!(o.svg || o.mermaid || o.drawio || o.c4)
  if (o.view && hasExports) {
    // Exports show the view; the map file keeps its own collapsed state and layout.
    await writeExports({ ...o, view: undefined }, withView(project, o.view), log)
    return (await laidOut(project)).project
  }
  const { view, laid, project: withLayout } = await laidOut(project)
  if (o.svg) {
    await writeOut(o.svg, diagramToSvg(view, laid, o.theme).svg)
    log(`wrote ${o.svg}`)
  }
  if (o.mermaid) {
    const mmd = diagramToMermaid(view)
    const text = /\.(md|markdown)$/i.test(o.mermaid)
      ? `<!-- Generated by Cartographer (crtgrphr). Re-run the scan to update. -->\n\n\`\`\`mermaid\n${mmd.trimEnd()}\n\`\`\`\n`
      : mmd
    await writeOut(o.mermaid, text)
    log(`wrote ${o.mermaid}`)
  }
  if (o.drawio) {
    await writeOut(o.drawio, diagramToDrawio(view, laid))
    log(`wrote ${o.drawio}`)
  }
  if (o.c4) {
    await writeOut(o.c4, diagramToC4PlantUml(view))
    log(`wrote ${o.c4}`)
  }
  return withLayout
}

/** The part of a diff that changes the shape of the system (not counts or wording details). */
export function structuralDiff(d: DiagramDiff): DiagramDiff {
  return {
    ...d,
    changedNodes: d.changedNodes.filter((c) => c.fields.some((f) => f === 'label' || f === 'role')),
    changedEdges: [],
  }
}

/** Merge a fresh scan into an existing map (or start one), keeping the user's work. */
function merge(existing: CartographProject | null, scanned: IRDiagram, root: string): { project: CartographProject; diff: DiagramDiff | null } {
  if (!existing) {
    const p = emptyProject()
    return { project: { ...p, diagram: { ...scanned, origin: { kind: 'repo', root, scannedAt: new Date().toISOString() } } }, diff: null }
  }
  const diff = diffDiagrams(existing.diagram, scanned)
  const changed = !diffIsEmpty(diff)
  const merged = applyRescan(existing, scanned)
  const origin = { kind: 'repo' as const, root, ...(changed ? { scannedAt: new Date().toISOString() } : existing.diagram.origin?.scannedAt ? { scannedAt: existing.diagram.origin.scannedAt } : {}) }
  return { project: { ...merged, diagram: { ...merged.diagram, origin } }, diff }
}

function bullets(diff: DiagramDiff, scanned: IRDiagram, before: IRDiagram): string[] {
  const label = (d: IRDiagram, id: string): string => d.nodes.find((n) => n.id === id)?.label ?? id
  const lines: string[] = []
  for (const n of diff.addedNodes) lines.push(`+ ${n.label}${n.sublabel ? ` (${n.sublabel})` : ''}`)
  for (const n of diff.removedNodes) lines.push(`- ${n.label}`)
  for (const c of diff.changedNodes) lines.push(`~ ${c.before.label}: ${c.fields.map((f) => `${f} "${(c.before as any)[f] ?? ''}" → "${(c.after as any)[f] ?? ''}"`).join(', ')}`)
  for (const e of diff.addedEdges) lines.push(`+ ${label(scanned, e.source)} → ${label(scanned, e.target)}`)
  for (const e of diff.removedEdges) lines.push(`- ${label(before, e.source)} → ${label(before, e.target)}`)
  for (const c of diff.changedEdges) lines.push(`~ ${label(scanned, c.after.source)} → ${label(scanned, c.after.target)}: ${c.fields.join(', ')}`)
  return lines
}

/** Most parts a drift picture draws; past this, Mermaid renders it too small to read. */
export const DRIFT_PICTURE_MAX = 60

/**
 * The map after the change, with what was removed kept as ghosts and every
 * change coloured, as Mermaid: GitHub draws it in PR comments and job summaries.
 */
export function driftPicture(diff: DiagramDiff, scanned: IRDiagram, before: IRDiagram): string | null {
  if (before.type === 'sequence' || before.type === 'lifecycle') return null
  const applied = applyRescan({ schema_version: 1, diagram: before, layout: {} }, scanned).diagram
  const ids = new Set([...applied.nodes, ...diff.removedNodes].map((n) => n.id))
  const preview: IRDiagram = {
    ...applied,
    nodes: [...applied.nodes, ...diff.removedNodes.filter((n) => !applied.nodes.some((a) => a.id === n.id))],
    edges: [...applied.edges, ...diff.removedEdges.filter((e) => ids.has(e.source) && ids.has(e.target))],
  }
  if (preview.nodes.filter((n) => n.role !== 'group').length > DRIFT_PICTURE_MAX) return null
  const mark = new Map<string, DriftKind>()
  for (const n of diff.addedNodes) mark.set(n.id, 'added')
  for (const e of diff.addedEdges) mark.set(e.id, 'added')
  for (const n of diff.removedNodes) mark.set(n.id, 'removed')
  for (const e of diff.removedEdges) mark.set(e.id, 'removed')
  for (const c of diff.changedNodes) mark.set(c.after.id, 'changed')
  for (const c of diff.changedEdges) mark.set(c.after.id, 'changed')
  return driftToMermaid(preview, mark)
}

export function driftReport(mapPath: string, diff: DiagramDiff, scanned: IRDiagram, before: IRDiagram, updated: boolean): string {
  const rows = bullets(diff, scanned, before)
  const picture = driftPicture(diff, scanned, before)
  const out = [
    `## Architecture map drift: ${diffSummary(diff)}`,
    '',
    `The code no longer matches \`${posix(mapPath)}\`.`,
    '',
    '```diff',
    ...rows,
    '```',
    '',
    ...(picture
      ? ['<details open><summary>The map after this change (green: added, red: removed, amber: changed)</summary>', '', '```mermaid', picture.trimEnd(), '```', '', '</details>', '']
      : []),
    updated
      ? 'The map has been updated; commit the changed files.'
      : `To update it, run \`crtgrphr scan --out ${posix(mapPath)}\` (or Re-scan in the Cartographer app) and commit the result. Your edits, pins and hand-added parts are kept.`,
    '',
  ]
  return out.join('\n')
}

export async function run(argv: string[], io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) }): Promise<number> {
  let o: Options
  try {
    o = parseArgs(argv)
  } catch (e) {
    io.err(`crtgrphr: ${(e as Error).message}\nRun crtgrphr --help for usage.`)
    return 2
  }
  const log = (s: string): void => {
    if (!o.quiet) io.out(s)
  }
  notes = (s) => {
    if (!o.quiet) io.err(s)
  }
  try {
    switch (o.cmd) {
      case '':
      case 'help':
        io.out(HELP)
        return 0
      case 'version':
        io.out(VERSION)
        return 0

      case 'scan': {
        const dir = resolve(o.positional[0] ?? '.')
        const scanned = await scanFolder(dir, '', { helm: o.helm })
        const existing = o.out && existsSync(o.out) ? await loadMap(o.out) : null
        const { project, diff } = merge(existing, scanned, dir)
        const final = await writeExports(o, project, log)
        if (o.out) {
          await writeOut(o.out, serializeProject(final, { filePath: resolve(o.out) }))
          log(`${existing ? 'updated' : 'wrote'} ${o.out}${diff ? ` (${diffSummary(diff)})` : ''}`)
        }
        // Nothing to write to: print the map itself, so it can be piped.
        if (!o.out && !o.svg && !o.mermaid && !o.drawio && !o.c4) {
          io.out(serializeProject(final).trimEnd())
          return 0
        }
        const n = scanned.nodes.filter((x) => x.role !== 'group').length
        log(`${scanned.title}: ${n} part${n === 1 ? '' : 's'}, ${scanned.edges.length} link${scanned.edges.length === 1 ? '' : 's'}. ${scanned.subtitle ?? ''}`)
        return 0
      }

      case 'check': {
        const mapPath = o.map ?? o.out
        if (!mapPath) throw new UsageError('check needs --map <file>')
        if (!existsSync(mapPath)) throw new Error(`no map at ${mapPath}; create one with: crtgrphr scan --out ${posix(mapPath)}`)
        const existing = await loadMap(mapPath)
        // Which folder to compare with: the one given, or the one the map records.
        // A map that records none (made by hand, imported) needs the folder given.
        const recorded = existing.diagram.origin?.root
        if (!o.positional[0] && !recorded) {
          throw new UsageError(`${posix(mapPath)} doesn't record which folder it was made from; give it: crtgrphr check <folder> --map ${posix(mapPath)}`)
        }
        const dir = resolve(o.positional[0] ?? recorded!)
        const scanned = await scanFolder(dir, o.positional[0] ? '' : ` (recorded in ${posix(mapPath)}; if the code moved, give the folder: crtgrphr check <folder> --map ${posix(mapPath)})`, { helm: o.helm })
        const full = diffDiagrams(existing.diagram, scanned)
        const diff = o.strict ? full : structuralDiff(full)
        if (diffIsEmpty(diff)) {
          const details = diffIsEmpty(full) ? '' : ` (only details changed: ${diffSummary(full)}; run scan --out to refresh them)`
          log(`${posix(mapPath)} is up to date with ${posix(relative(process.cwd(), dir) || '.')}${details}`)
          if (o.report) await writeOut(o.report, `## Architecture map: up to date\n\n\`${posix(mapPath)}\` matches the code${details}.\n`)
          return 0
        }
        let updated = false
        if (o.update) {
          const { project } = merge(existing, scanned, dir)
          const final = await writeExports(o, project, log)
          await writeOut(mapPath, serializeProject(final, { filePath: resolve(mapPath) }))
          updated = true
        }
        const report = driftReport(mapPath, diff, scanned, existing.diagram, updated)
        if (o.report) await writeOut(o.report, report)
        if (!o.quiet) io.out(report)
        return updated ? 0 : 1
      }

      case 'export': {
        const file = o.positional[0]
        if (!file) throw new UsageError('export needs a map file')
        if (!o.svg && !o.mermaid && !o.drawio && !o.c4) throw new UsageError('export needs at least one of --svg, --mermaid, --drawio, --c4')
        await writeExports(o, await loadMap(file), log)
        return 0
      }

      default:
        throw new UsageError(`unknown command "${o.cmd}"`)
    }
  } catch (e) {
    if (e instanceof UsageError) io.err(`crtgrphr: ${e.message}\nRun crtgrphr --help for usage.`)
    else io.err(`crtgrphr: ${e instanceof Error ? e.message : String(e)}`)
    return 2
  }
}

