/**
 * Smoke test for the PACKAGED app (release/<platform>-unpacked): proves the
 * installer contents actually run, including runtime dependencies the main
 * process loads from node_modules (js-yaml for compose scanning).
 *
 * Run after `npm run package`:  node tests/e2e/packaged.mjs
 * Data stays inside the project (CRTGRPHR_USER_DATA under tests/.tmp).
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tmp = join(root, 'tests/.tmp/packaged')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

// electron-builder names the macOS folder after the architecture (mac, mac-arm64).
const candidates = {
  win32: ['release/win-unpacked/Cartographer.exe'],
  linux: ['release/linux-unpacked/cartographer'],
  darwin: ['release/mac-arm64/Cartographer.app/Contents/MacOS/Cartographer', 'release/mac/Cartographer.app/Contents/MacOS/Cartographer'],
}[process.platform] ?? []
const executablePath = candidates.map((c) => join(root, c)).find((p) => existsSync(p)) ?? join(root, candidates[0] ?? 'release')
if (!existsSync(executablePath)) {
  console.error(`No packaged app at ${executablePath}. Run \`npm run package\` first.`)
  process.exit(1)
}

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}

const app = await electron.launch({
  executablePath,
  args: process.env.CI ? ['--no-sandbox'] : [],
  env: {
    ...process.env,
    CRTGRPHR_USER_DATA: join(tmp, 'userdata'),
    CRTGRPHR_TEST_DIALOGS: JSON.stringify({ folder: join(root, 'tests/fixtures/repos/compose-basic'), confirm: true }),
  },
  timeout: 60000,
})
try {
  const page = await app.firstWindow()
  await page.getByTestId('welcome').waitFor({ timeout: 30000 })
  console.log('✓ packaged app starts on the welcome screen')

  // A stale release/ folder from an earlier build must not pass for this one.
  const want = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version
  const got = await app.evaluate(() => process.versions.electron)
  if (got !== want) fail(`packaged app runs Electron ${got}, but this checkout uses ${want}: rebuild with npm run package`)
  else console.log(`✓ packaged with this checkout's Electron (${got})`)

  await page.getByTestId('welcome').getByRole('button', { name: 'Scan a repository…' }).click()
  await page.waitForFunction(() => /^Mapped 7 components/.test(document.querySelector('[data-testid=status]')?.textContent ?? ''), null, { timeout: 15000 })
  console.log('✓ scanning a docker-compose repo works (js-yaml is packaged)')

  const nodes = await page.locator('.react-flow__node').count()
  if (nodes !== 7) fail(`expected 7 nodes, got ${nodes}`)
  else console.log('✓ the map renders')

  // The worker starts in the background (its script is large); give a slow machine time.
  const engine = await page
    .waitForFunction(() => document.documentElement.dataset.layout === 'worker', null, { timeout: 30000 })
    .then(() => 'worker', () => page.evaluate(() => document.documentElement.dataset.layout))
  if (engine !== 'worker') fail(`layout should run in a worker in the packaged app, got ${engine}`)
  else console.log('✓ layout runs in a Web Worker (from inside the asar)')
} catch (e) {
  fail(e?.message ?? String(e))
} finally {
  await app.close()
}
if (!process.exitCode) console.log('packaged smoke test passed')
