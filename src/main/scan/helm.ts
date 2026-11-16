/**
 * Rendering Helm charts with the `helm` binary, when the user opts in (CLI
 * --helm, the app's setting). `helm template` renders locally: it doesn't reach
 * the cluster, and dependencies are never downloaded (a chart whose charts/ is
 * missing them fails to render and is read from Chart.yaml as before).
 *
 * Run with execFile (no shell), a time limit and an output cap.
 */
import { execFile } from 'node:child_process'

const TIMEOUT_MS = 30_000
const MAX_OUTPUT = 32 * 1024 * 1024

export type HelmRender = (chartDir: string, release: string) => Promise<{ text: string } | { error: string }>

function run(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; error?: Error }> {
  return new Promise((resolve) => {
    execFile('helm', args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, ...(cwd ? { cwd } : {}) }, (error, stdout, stderr) =>
      resolve({ stdout: String(stdout), stderr: String(stderr), ...(error ? { error } : {}) }),
    )
  })
}

/** A renderer when `helm` is on the PATH, otherwise null. */
export async function helmRenderer(): Promise<HelmRender | null> {
  const probe = await run(['version', '--short'])
  if (probe.error) return null
  return async (chartDir, release) => {
    // Release names must be DNS labels; the chart's own name usually is one.
    const name = release.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 53) || 'release'
    const res = await run(['template', name, chartDir])
    if (res.error) {
      const why = (res.stderr || res.error.message).trim().split('\n').find((l) => l.trim()) ?? 'failed'
      return { error: why.replace(/^Error:\s*/, '') }
    }
    return { text: res.stdout }
  }
}

/**
 * Split `helm template` output into documents, each with the template it came
 * from: `# Source: shop/charts/redis/templates/svc.yaml` → that path inside the
 * chart folder.
 */
export function renderedDocs(output: string): { source: string | null; text: string }[] {
  const out: { source: string | null; text: string }[] = []
  for (const part of output.split(/^---\s*$/m)) {
    if (!part.trim()) continue
    const src = part.match(/^#\s*Source:\s*(\S+)/m)?.[1] ?? null
    // The path starts with the chart's own name; the rest is relative to the chart folder.
    out.push({ source: src ? src.split('/').slice(1).join('/') : null, text: part })
  }
  return out
}
