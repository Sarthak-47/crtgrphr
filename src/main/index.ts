import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { join, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import { scanRepositoryWithReport } from './repo-scan'
import { isInside, normalizePath } from '../shared/paths'
import type { IRDiagram } from '../shared/ir'
import { generateDiagram, testConnection } from './ai'
import { getApiKey, keyEncryptionAvailable, keyStatus, loadAiSettings, saveAiSettings, setApiKey } from './ai-settings'
import { DIAGRAM_TYPES, type DiagramType } from '../shared/ir'
import {
  GuardError,
  MAX_CLIPBOARD_BYTES,
  MAX_MAP_BYTES,
  checkOllamaUrl,
  cleanFileName,
  cleanFilters,
  cleanText,
  decodePngDataUrl,
  isSafeExternalUrl,
  isTrustedSender,
  str,
} from './guards'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !!process.env['ELECTRON_RENDERER_URL']
const devUrl = process.env['ELECTRON_RENDERER_URL']

/**
 * Where Electron keeps its data (caches, local storage). An installed app uses
 * the normal per-user location. Unpackaged runs (dev, tests) keep it inside the
 * project folder, so development never writes outside the project. Tests can
 * point it somewhere specific with CRTGRPHR_USER_DATA. Must run before `ready`.
 */
if (process.env.CRTGRPHR_USER_DATA) app.setPath('userData', resolve(process.env.CRTGRPHR_USER_DATA))
else if (!app.isPackaged) app.setPath('userData', join(app.getAppPath(), '.userdata'))

/**
 * Files the renderer may write to without a dialog. A path gets in only by the
 * user choosing it in a native Open/Save dialog, so the renderer can never write
 * to an arbitrary location (e.g. via a crafted project file).
 */
const approvedPaths = new Set<string>()
const approve = (p: string): string => {
  const abs = resolve(p)
  approvedPaths.add(abs)
  return abs
}

/**
 * Folders the user picked to scan this session. A re-scan reuses one directly;
 * any other folder (e.g. the origin written in an opened file) must be confirmed
 * in a folder dialog first, so a crafted file can't make us read arbitrary places.
 */
const approvedFolders = new Set<string>()
const folderKey = (p: string): string => normalizePath(resolve(p)).toLowerCase()

async function scanWithOrigin(dir: string): Promise<{ diagram: IRDiagram; warnings: string[] }> {
  const { diagram, warnings } = await scanRepositoryWithReport(dir)
  diagram.origin = { kind: 'repo', root: normalizePath(resolve(dir)), scannedAt: new Date().toISOString() }
  return { diagram, warnings }
}

/** Per-window "has unsaved changes" flag, reported by the renderer. */
const dirtyWindows = new Set<number>()

/** Test hook: E2E runs set this to skip native dialogs and use fixed paths. */
const testDialogs: { open?: string; save?: string; folder?: string; confirm?: boolean; reveal?: boolean } | null = process.env.CRTGRPHR_TEST_DIALOGS
  ? JSON.parse(process.env.CRTGRPHR_TEST_DIALOGS)
  : null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0f19',
    title: 'Cartographer',
    autoHideMenuBar: true,
    webPreferences: {
      // Sandboxed renderer: no Node, no Electron internals; only the small,
      // validated API the preload exposes (src/preload, src/main/guards.ts).
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  // New windows never open inside the app; plain web links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  // Never navigate the app window away from the app itself.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isDev || !url.startsWith(process.env['ELECTRON_RENDERER_URL']!)) e.preventDefault()
  })

  // Guard unsaved work on close.
  const id = win.webContents.id
  win.on('close', (e) => {
    if (!dirtyWindows.has(id) || testDialogs) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Discard changes and close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'This map has unsaved changes.',
      detail: 'Close anyway and lose them?',
    })
    if (choice !== 0) e.preventDefault()
  })
  win.on('closed', () => dirtyWindows.delete(id))

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/**
 * Minimal menu. The renderer owns editing shortcuts (undo, save, delete...), so
 * the menu only provides clipboard roles (needed for text fields on macOS) and
 * deliberately has no Reload accelerator, which would drop unsaved work.
 */
function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }] },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ---------------------------------- IPC --------------------------------- */

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Register an IPC handler that only answers the app's own page, and turns
 * rejected input (GuardError) into an ordinary `{ error }` result.
 */
function handle<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!isTrustedSender(e.senderFrame?.url, devUrl)) throw new Error(`Refused ${channel} from an untrusted page`)
    try {
      return await fn(e, ...(args as A))
    } catch (err) {
      if (err instanceof GuardError) return { error: err.message }
      throw err
    }
  })
}

/** Read a map file, refusing anything larger than a map could reasonably be. */
async function readMapFile(path: string): Promise<string> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('not a file')
  if (info.size > MAX_MAP_BYTES) throw new GuardError(`${path} is too large to be a map (${Math.round(info.size / 1048576)} MB)`)
  return readFile(path, 'utf8')
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

handle('repo:pickAndScan', async (e) => {
  let dir = testDialogs?.folder
  if (!dir) {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, { title: 'Choose a repository folder to map', properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    dir = res.filePaths[0]
  }
  try {
    const { diagram, warnings } = await scanWithOrigin(dir)
    approvedFolders.add(folderKey(dir))
    return { canceled: false, diagram, warnings, dir: diagram.origin!.root }
  } catch (err) {
    return { canceled: false, error: `Couldn't read ${dir}: ${errorMessage(err)}` }
  }
})

handle('repo:rescan', async (e, args: { root: string }) => {
  let dir = str(obj(args).root, 'Folder', 4096)
  if (!approvedFolders.has(folderKey(dir))) {
    // Not picked this session: let the user confirm (or correct) the folder.
    if (testDialogs?.folder) dir = testDialogs.folder
    else {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const res = await dialog.showOpenDialog(win!, {
        title: 'Confirm the folder to re-scan',
        defaultPath: dir,
        properties: ['openDirectory'],
      })
      if (res.canceled || res.filePaths.length === 0) return { canceled: true }
      dir = res.filePaths[0]
    }
  }
  try {
    const { diagram, warnings } = await scanWithOrigin(dir)
    approvedFolders.add(folderKey(dir))
    return { canceled: false, diagram, warnings, dir: diagram.origin!.root }
  } catch (err) {
    return { canceled: false, error: `Couldn't read ${dir}: ${errorMessage(err)}` }
  }
})

/** Show a node's source in the file manager. Only paths inside the map's root. */
handle('shell:reveal', async (_e, args: { root: string; rel: string }) => {
  const root = normalizePath(resolve(str(obj(args).root, 'Folder', 4096)))
  const target = normalizePath(resolve(root, str(obj(args).rel, 'Path', 4096)))
  if (!isInside(root, target)) return { error: 'That path is outside the mapped folder.' }
  try {
    await stat(target)
  } catch {
    return { error: `${target} no longer exists. Re-scan to refresh the map.` }
  }
  if (!testDialogs) shell.showItemInFolder(target.replace(/\//g, process.platform === 'win32' ? '\\' : '/'))
  return { path: target }
})

handle('file:openProject', async (e) => {
  let path = testDialogs?.open
  if (!path) {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      title: 'Open a Cartographer map',
      filters: [
        { name: 'Cartographer map', extensions: ['crtgrphr'] },
        { name: 'JSON', extensions: ['json'] },
      ],
      properties: ['openFile'],
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    path = res.filePaths[0]
  }
  try {
    const text = await readMapFile(path)
    return { canceled: false, text, path: approve(path) }
  } catch (err) {
    return { canceled: false, error: err instanceof GuardError ? err.message : `Couldn't open ${path}: ${errorMessage(err)}` }
  }
})

/** Re-open a map from the recent list. Only map files; the path becomes writable. */
handle('file:openPath', async (_e, args: { path: string }) => {
  const path = resolve(str(obj(args).path, 'Path', 4096))
  if (!/\.(crtgrphr|json)$/i.test(path)) return { error: 'Only Cartographer maps (.crtgrphr or .json) can be opened.' }
  try {
    const text = await readMapFile(path)
    return { text, path: approve(path) }
  } catch (err) {
    if (err instanceof GuardError) return { error: err.message }
    return { error: `Couldn't open ${path}: ${errorMessage(err)}`, missing: true }
  }
})

handle(
  'file:saveAs',
  async (e, input: { defaultName: string; text: string; filters?: Electron.FileFilter[]; remember?: boolean }) => {
    const args = obj(input)
    const text = cleanText(args.text)
    const filters = cleanFilters(args.filters)
    const defaultName = cleanFileName(args.defaultName, 'map')
    let path = testDialogs?.save
    if (path && filters?.[0]) {
      // In tests, keep the requested extension so exports land next to the project.
      path = path.replace(/\.[^.\\/]+$/, '') + '.' + filters[0].extensions[0]
    }
    if (!path) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const res = await dialog.showSaveDialog(win!, { title: 'Save', defaultPath: defaultName, filters })
      if (res.canceled || !res.filePath) return { canceled: true }
      path = res.filePath
    }
    try {
      await writeFile(path, text, 'utf8')
      return { canceled: false, path: args.remember === true ? approve(path) : resolve(path) }
    } catch (err) {
      return { canceled: false, error: `Couldn't save ${path}: ${errorMessage(err)}` }
    }
  },
)

handle('file:writeTo', async (_e, input: { path: string; text: string }) => {
  const args = obj(input)
  const abs = resolve(str(args.path, 'Path', 4096))
  if (!approvedPaths.has(abs)) return { error: 'That file was not opened or saved in this session; use Save As.' }
  const text = cleanText(args.text)
  try {
    await writeFile(abs, text, 'utf8')
    return { path: abs }
  } catch (err) {
    return { error: `Couldn't save ${abs}: ${errorMessage(err)}` }
  }
})

handle('file:savePng', async (e, input: { defaultName: string; dataUrl: string }) => {
  const args = obj(input)
  // Check the image before asking where to save it.
  const bytes = decodePngDataUrl(args.dataUrl)
  let path = testDialogs?.save ? testDialogs.save.replace(/\.[^.\\/]+$/, '') + '.png' : undefined
  if (!path) {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export PNG',
      defaultPath: cleanFileName(args.defaultName, 'map.png'),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    path = res.filePath
  }
  try {
    await writeFile(path, bytes)
    return { canceled: false, path: resolve(path) }
  } catch (err) {
    return { canceled: false, error: `Couldn't export ${path}: ${errorMessage(err)}` }
  }
})

handle('app:confirm', async (e, input: { message: string; detail?: string; confirmLabel: string }) => {
  const raw = obj(input)
  const args = {
    message: str(raw.message, 'Message', 2000),
    detail: raw.detail === undefined ? undefined : str(raw.detail, 'Detail', 4000),
    confirmLabel: str(raw.confirmLabel, 'Button', 60),
  }
  if (testDialogs) return testDialogs.confirm ?? true
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
  const res = await dialog.showMessageBox(win!, {
    type: 'warning',
    buttons: [args.confirmLabel, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: args.message,
    detail: args.detail,
  })
  return res.response === 0
})

/* ----------------------------------- AI ----------------------------------- */

handle('ai:getSettings', async () => ({
  settings: await loadAiSettings(),
  key: await keyStatus(),
  encryption: keyEncryptionAvailable(),
}))

handle('ai:saveSettings', async (e, input: unknown) => {
  // A model server that isn't on this machine means descriptions leave it: the
  // user confirms that in a native dialog the renderer can't answer for them.
  const current = await loadAiSettings()
  const next = { ...obj(input) }
  const checked = checkOllamaUrl(next.ollamaUrl)
  if (!checked) next.ollamaUrl = current.ollamaUrl
  else if (checked.kind !== 'loopback' && checked.url !== current.ollamaUrl) {
    let allowed = testDialogs ? (testDialogs.confirm ?? true) : false
    if (!testDialogs) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const res = await dialog.showMessageBox(win!, {
        type: 'warning',
        buttons: ['Use this server', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Send descriptions to ${new URL(checked.url).host}?`,
        detail:
          checked.kind === 'public'
            ? 'This Ollama server is on the internet, not this computer. Descriptions you write will be sent to it.'
            : 'This Ollama server is on your local network, not this computer. Descriptions you write will be sent to it.',
      })
      allowed = res.response === 0
    }
    if (!allowed) next.ollamaUrl = current.ollamaUrl
  }
  return { settings: await saveAiSettings(next) }
})

handle('ai:setKey', async (_e, key: string | null) => {
  const { persisted } = await setApiKey(typeof key === 'string' ? str(key, 'API key', 1000).trim() || null : null)
  return { key: await keyStatus(), persisted }
})

handle('ai:test', async () => {
  const settings = await loadAiSettings()
  try {
    return { message: await testConnection(settings, settings.provider === 'anthropic' ? await getApiKey() : null) }
  } catch (err) {
    return { error: errorMessage(err) }
  }
})

handle('ai:generate', async (_e, input: { description: string; type?: string }) => {
  const args = obj(input) as { description?: unknown; type?: unknown }
  const settings = await loadAiSettings()
  const type = DIAGRAM_TYPES.includes(args.type as DiagramType) ? (args.type as DiagramType) : undefined
  try {
    const out = await generateDiagram(
      { description: String(args.description ?? '').slice(0, 20_000), type },
      { settings, apiKey: settings.provider === 'anthropic' ? await getApiKey() : null },
    )
    return { diagram: out.diagram, fixes: out.fixes, attempts: out.attempts, provider: settings.provider }
  } catch (err) {
    return { error: errorMessage(err) }
  }
})

handle('clipboard:writeText', (_e, input: string) => {
  const text = cleanText(input, MAX_CLIPBOARD_BYTES)
  // Test runs keep the text in memory instead of overwriting the real clipboard.
  if (testDialogs) (globalThis as { __crtgrphrClipboard?: string }).__crtgrphrClipboard = text
  else clipboard.writeText(text)
  return true
})

ipcMain.on('app:setDirty', (e, dirty: boolean) => {
  if (!isTrustedSender(e.senderFrame?.url, devUrl)) return
  if (dirty === true) dirtyWindows.add(e.sender.id)
  else dirtyWindows.delete(e.sender.id)
})

app.whenReady().then(() => {
  // The app needs no camera, microphone, notifications or other permissions.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
