/**
 * End-to-end test: drives the real, built Electron app with Playwright.
 *
 * Native dialogs can't be clicked by a test, so the main process reads
 * CRTGRPHR_TEST_DIALOGS and uses fixed paths instead (see src/main/index.ts).
 * Everything is written under tests/.tmp/e2e, inside the project.
 *
 * Run with: npm run e2e   (builds first)
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tmp = join(root, 'tests/.tmp/e2e')
const mapPath = join(tmp, 'map.crtgrphr')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

const results = []
let failed = 0
async function step(name, fn) {
  const t = Date.now()
  try {
    await fn()
    results.push(`  ✓ ${name} (${Date.now() - t} ms)`)
  } catch (e) {
    failed++
    results.push(`  ✗ ${name}\n      ${String(e?.message ?? e).split('\n').join('\n      ')}`)
    throw e
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

const app = await electron.launch({
  args: [...(process.env.CI ? ['--no-sandbox'] : []), root],
  cwd: root,
  env: {
    ...process.env,
    CRTGRPHR_TEST_DIALOGS: JSON.stringify({
      save: mapPath,
      open: mapPath,
      folder: join(root, 'tests/fixtures/repos/compose-basic'),
      confirm: true,
    }),
  },
  timeout: 60000,
})

const page = await app.firstWindow()
const status = () => page.getByTestId('status').textContent()
const nodeCount = () => page.locator('.react-flow__node').count()
const edgeCount = () => page.locator('.react-flow__edge').count()
const waitStatus = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid=status]')?.textContent ?? ''), re.source, { timeout: 10000 })
const waitNodes = (n) => page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n, n, { timeout: 10000 })

try {
  await step('app launches and lays out the sample map', async () => {
    await page.waitForSelector('.react-flow__node', { timeout: 30000 })
    await waitNodes(9)
    expect((await edgeCount()) === 9, `expected 9 edges, got ${await edgeCount()}`)
    expect(!(await page.title()).startsWith('●'), 'sample should start clean')
  })

  await step('double-click renames a node in place', async () => {
    await page.getByTestId('node-api').dblclick()
    const input = page.locator('.cg-inline-rename')
    await input.waitFor()
    await input.fill('Gateway API')
    await input.press('Enter')
    await page.getByTestId('node-api').getByText('Gateway API').waitFor()
    expect((await page.title()).startsWith('●'), `title should show unsaved marker, got "${await page.title()}"`)
  })

  await step('Ctrl+S on a never-saved map saves (via Save As) and clears the marker', async () => {
    // click empty canvas (bottom middle, clear of the legend, controls and minimap)
    const pane = await page.locator('.react-flow__pane').boundingBox()
    await page.mouse.click(pane.x + pane.width / 2, pane.y + pane.height - 12)
    await page.keyboard.press('Control+s')
    await waitStatus(/^Saved /)
    expect(existsSync(mapPath), 'map file should exist')
    expect(readFileSync(mapPath, 'utf8').includes('"label":"Gateway API"'), 'saved file should contain the rename')
    expect(!(await page.title()).startsWith('●'), 'title should be clean after save')
  })

  await step('dragging a node pins it, and a second Ctrl+S writes without a dialog', async () => {
    const box = await page.getByTestId('node-users').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + i * 15)
    await page.mouse.up()
    await page.getByTestId('node-users').locator('.cg-pin').waitFor()
    expect((await page.title()).startsWith('●'), 'pin should make the map dirty')
    await page.keyboard.press('Control+s')
    await waitStatus(/^Saved /)
    const saved = JSON.parse(readFileSync(mapPath, 'utf8'))
    expect(saved.layout.users?.pinned === true, 'saved layout should have users pinned')
  })

  await step('clicking an edge selects it; Delete removes it; undo restores it', async () => {
    await page.getByTestId('edge-label-e5').click() // the "SQL" edge
    await page.getByTestId('inspector').getByText('Edge', { exact: true }).waitFor()
    await page.keyboard.press('Delete')
    await waitStatus(/Edge deleted/)
    expect((await edgeCount()) === 8, `expected 8 edges after delete, got ${await edgeCount()}`)
    await page.keyboard.press('Control+z')
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 9)
    await page.keyboard.press('Control+y')
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 8)
    await page.keyboard.press('Control+s')
    await waitStatus(/^Saved /)
  })

  await step('Ctrl+F finds and focuses a node', async () => {
    await page.keyboard.press('Control+f')
    await page.getByLabel('Find a node').fill('kafka')
    await page.keyboard.press('Enter')
    await page.locator('.cg-node-selected[data-testid=node-queue]').waitFor()
  })

  await step('Ctrl+N starts a blank map', async () => {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+n')
    await page.getByText('An empty map').waitFor()
    expect((await nodeCount()) === 0, 'new map should be empty')
  })

  await step('Ctrl+O reopens the saved map exactly: rename, pin and deleted edge', async () => {
    await page.keyboard.press('Control+o')
    await waitStatus(/^Opened /)
    await waitNodes(9)
    expect((await edgeCount()) === 8, `expected 8 edges after reopen, got ${await edgeCount()}`)
    await page.getByTestId('node-api').getByText('Gateway API').waitFor()
    await page.getByTestId('node-users').locator('.cg-pin').waitFor()
    expect((await page.getByTestId('file-path').textContent()).includes('map.crtgrphr'), 'footer should show the file')
  })

  await step('Export SVG and PNG write real files', async () => {
    await page.getByRole('button', { name: 'File ▾' }).hover()
    await page.getByRole('button', { name: 'Export SVG' }).click()
    await waitStatus(/^Exported .*\.svg$/)
    const svg = readFileSync(join(tmp, 'map.svg'), 'utf8')
    expect(svg.startsWith('<svg') && svg.includes('Gateway API'), 'SVG should contain the map')

    await page.getByRole('button', { name: 'File ▾' }).hover()
    await page.getByRole('button', { name: 'Export PNG' }).click()
    await waitStatus(/^Exported .*\.png$/)
    const png = readFileSync(join(tmp, 'map.png'))
    expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG signature')
    expect(png.length > 5000, `PNG suspiciously small: ${png.length} bytes`)
  })

  await step('the renderer cannot write to a path the user never chose', async () => {
    const evil = join(tmp, 'evil.txt')
    const res = await page.evaluate((p) => window.cartographer.file.writeTo({ path: p, text: 'x' }), evil)
    expect(res.error && !existsSync(evil), `writeTo outside approved paths should fail, got ${JSON.stringify(res)}`)
  })

  const loadSample = async (name) => {
    await page.getByRole('button', { name: 'Samples ▾' }).hover()
    await page.getByRole('button', { name, exact: true }).click()
    await waitStatus(/^Loaded sample/)
  }
  const roleNodes = () => page.locator('.react-flow__node-role').count()

  await step('every sample type renders, with real shapes and a legend', async () => {
    const expected = { Architecture: 9, Workflow: 9, Sequence: 4, Dataflow: 6, Lifecycle: 6 }
    for (const [name, n] of Object.entries(expected)) {
      await loadSample(name)
      await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node-role').length === n, n)
      expect(await page.getByTestId('legend').isVisible(), `${name}: legend visible`)
    }
    await loadSample('Workflow')
    expect((await page.locator('[data-shape=diamond]').count()) === 2, 'workflow draws two diamonds')
    await loadSample('Architecture')
    expect((await page.locator('[data-shape=cylinder]').count()) === 2, 'architecture draws two cylinders')
  })

  await step('sequence: lifelines, drag a participant to reorder, move a message', async () => {
    await loadSample('Sequence')
    expect((await page.locator('.react-flow__node-lifeline').count()) === 4, 'one lifeline per participant')
    expect(await page.getByRole('combobox', { name: 'Flow direction' }).isDisabled(), 'direction is fixed for sequences')
    const xOf = async (id) => (await page.getByTestId(`node-${id}`).boundingBox()).x
    const order = async () => {
      const ids = ['client', 'app', 'cache', 'db']
      const xs = await Promise.all(ids.map(xOf))
      return ids.map((id, i) => [id, xs[i]]).sort((a, b) => a[1] - b[1]).map(([id]) => id)
    }
    expect((await order()).join() === 'client,app,cache,db', `initial order ${await order()}`)
    // drag Redis (cache) to the left of the web app
    const from = await page.getByTestId('node-cache').boundingBox()
    const to = await page.getByTestId('node-app').boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      const x = from.x + from.width / 2 + ((to.x - 10 - (from.x + from.width / 2)) * i) / steps
      await page.mouse.move(x, from.y + from.height / 2)
    }
    await page.mouse.up()
    await waitStatus(/Participants reordered/)
    await page.waitForFunction(async () => true)
    expect((await order()).join() === 'client,cache,app,db', `after drag: ${await order()}`)

    // move the first message later via the inspector
    await page.getByTestId('edge-label-e1').click()
    await page.getByText('Message 1 of 5').waitFor()
    await page.getByRole('button', { name: '↓ Later' }).click()
    await page.getByText('Message 2 of 5').waitFor()
    await page.keyboard.press('Escape')
  })

  await step('Scan repo maps a real folder (compose fixture)', async () => {
    await page.getByRole('button', { name: 'Scan repo…' }).click()
    await waitStatus(/^Mapped 7 components/)
    await waitNodes(7)
    expect((await page.getByLabel('Map title').inputValue()) === 'compose-basic', 'title should be the folder name')
  })
} catch {
  // reported below
} finally {
  await app.close()
}

console.log(`\nE2E (Electron)\n${results.join('\n')}\n`)
if (failed) {
  console.log(`${failed} step failed`)
  process.exit(1)
}
console.log(`all ${results.length} steps passed`)
