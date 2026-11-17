#!/usr/bin/env node
/**
 * Stages the command-line tool as an npm package in release/npm/ (git-ignored):
 * the committed single-file bundle, a package.json made from the root one, and a
 * short README. Nothing is published here; the Release workflow publishes the
 * staged folder when an NPM_TOKEN secret exists.
 *
 *   node scripts/npm-package.mjs            stage it
 *   node scripts/npm-package.mjs --check    stage it and run `npm pack --dry-run`
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'release', 'npm')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bundle = join(root, 'action', 'dist', 'crtgrphr.mjs')

const bundled = execFileSync(process.execPath, [bundle, '--version'], { encoding: 'utf8' }).trim()
if (bundled !== pkg.version) {
  console.error(`action/dist/crtgrphr.mjs is version ${bundled}, package.json is ${pkg.version}: run npm run build:cli`)
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
copyFileSync(bundle, join(out, 'crtgrphr.mjs'))
for (const f of ['LICENSE', 'NOTICE']) if (existsSync(join(root, f))) copyFileSync(join(root, f), join(out, f))

const manifest = {
  name: pkg.name,
  version: pkg.version,
  description: 'Architecture maps from code: scan a repository into an auto-laid-out map, check it for drift in CI, export SVG, Mermaid, draw.io and C4.',
  keywords: ['architecture', 'diagram', 'docker-compose', 'kubernetes', 'helm', 'terraform', 'monorepo', 'mermaid', 'c4', 'drift', 'documentation'],
  license: pkg.license,
  author: pkg.author,
  homepage: 'https://sarthak-47.github.io/crtgrphr/',
  repository: pkg.repository,
  bugs: { url: 'https://github.com/Sarthak-47/crtgrphr/issues' },
  type: 'module',
  bin: { crtgrphr: 'crtgrphr.mjs' },
  files: ['crtgrphr.mjs', 'README.md', ...['LICENSE', 'NOTICE'].filter((f) => existsSync(join(root, f)))],
  engines: { node: '>=18' },
}
writeFileSync(join(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

writeFileSync(
  join(out, 'README.md'),
  `# crtgrphr

The command-line tool of [Cartographer](https://github.com/Sarthak-47/crtgrphr): turn a
repository into an architecture map, and keep the map honest in CI.

\`\`\`bash
npx crtgrphr scan . --out docs/architecture.crtgrphr --svg docs/architecture.svg
npx crtgrphr check . --map docs/architecture.crtgrphr --report drift.md
\`\`\`

It reads Docker Compose, Kubernetes and Helm, Terraform, npm/pnpm/yarn workspaces,
Maven, Gradle and .NET builds, and import graphs in TypeScript/JavaScript, Python, Go
and Rust. Every link carries its evidence (the file and setting that declared it, or the
hint it was inferred from). \`check\` exits 1 when the code has drifted from the committed map.

- \`scan [dir] --out map.crtgrphr\`: write (or update, keeping your edits) a map
- \`check [dir] --map map.crtgrphr [--update] [--report drift.md]\`: compare with the code
- \`export map.crtgrphr --svg x.svg --mermaid x.md --drawio x.drawio --c4 x.puml [--view Overview]\`

One file, no dependencies, Node 18 or later. Open and edit maps in the desktop app;
run it in GitHub Actions with \`uses: Sarthak-47/crtgrphr@v${pkg.version}\`.
Run \`npx crtgrphr --help\` for every option.
`,
)

console.log(`staged ${pkg.name}@${pkg.version} in ${out}`)
if (process.argv.includes('--check')) {
  // Pack into the staging folder's own cache so nothing lands outside the project.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', ...(process.argv.includes('--tarball') ? [] : ['--dry-run'])], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, npm_config_cache: join(root, '.npm-cache') } })
}
