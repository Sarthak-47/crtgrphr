import { app, BrowserWindow, Menu, dialog, ipcMain, shell, type MenuItemConstructorOptions } from 'electron'
import { join, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import { scanRepository } from './repo-scan'
import { isInside, normalizePath } from '../shared/paths'
import type { IRDiagram } from '../shared/ir'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !!process.env['ELECTRON_RENDERER_URL']

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

async function scanWithOrigin(dir: string): Promise<IRDiagram> {
  const diagram = await scanRepository(dir)
  diagram.origin = { kind: 'repo', root: normalizePath(resolve(dir)), scannedAt: new Date().toISOString() }
  return diagram
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
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
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

ipcMain.handle('repo:pickAndScan', async (e) => {
  let dir = testDialogs?.folder
  if (!dir) {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, { title: 'Choose a repository folder to map', properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    dir = res.filePaths[0]
  }
  try {
    const diagram = await scanWithOrigin(dir)
    approvedFolders.add(folderKey(dir))
    return { canceled: false, diagram, dir: diagram.origin!.root }
  } catch (err) {
    return { canceled: false, error: `Couldn't read ${dir}: ${errorMessage(err)}` }
  }
})

ipcMain.handle('repo:rescan', async (e, args: { root: string }) => {
  let dir = args.root
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
    const diagram = await scanWithOrigin(dir)
    approvedFolders.add(folderKey(dir))
    return { canceled: false, diagram, dir: diagram.origin!.root }
  } catch (err) {
    return { canceled: false, error: `Couldn't read ${dir}: ${errorMessage(err)}` }
  }
})

/** Show a node's source in the file manager. Only paths inside the map's root. */
ipcMain.handle('shell:reveal', async (_e, args: { root: string; rel: string }) => {
  const root = normalizePath(resolve(args.root))
  const target = normalizePath(resolve(root, args.rel))
  if (!isInside(root, target)) return { error: 'That path is outside the mapped folder.' }
  try {
    await stat(target)
  } catch {
    return { error: `${target} no longer exists. Re-scan to refresh the map.` }
  }
  if (!testDialogs) shell.showItemInFolder(target.replace(/\//g, process.platform === 'win32' ? '\\' : '/'))
  return { path: target }
})

ipcMain.handle('file:openProject', async (e) => {
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
    const text = await readFile(path, 'utf8')
    return { canceled: false, text, path: approve(path) }
  } catch (err) {
    return { canceled: false, error: `Couldn't open ${path}: ${errorMessage(err)}` }
  }
})

/** Re-open a map from the recent list. Only map files; the path becomes writable. */
ipcMain.handle('file:openPath', async (_e, args: { path: string }) => {
  const path = resolve(args.path)
  if (!/\.(crtgrphr|json)$/i.test(path)) return { error: 'Only Cartographer maps (.crtgrphr or .json) can be opened.' }
  try {
    const text = await readFile(path, 'utf8')
    return { text, path: approve(path) }
  } catch (err) {
    return { error: `Couldn't open ${path}: ${errorMessage(err)}`, missing: true }
  }
})

ipcMain.handle(
  'file:saveAs',
  async (e, args: { defaultName: string; text: string; filters?: Electron.FileFilter[]; remember?: boolean }) => {
    let path = testDialogs?.save
    if (path && args.filters?.[0]) {
      // In tests, keep the requested extension so exports land next to the project.
      path = path.replace(/\.[^.\\/]+$/, '') + '.' + args.filters[0].extensions[0]
    }
    if (!path) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const res = await dialog.showSaveDialog(win!, { title: 'Save', defaultPath: args.defaultName, filters: args.filters })
      if (res.canceled || !res.filePath) return { canceled: true }
      path = res.filePath
    }
    try {
      await writeFile(path, args.text, 'utf8')
      return { canceled: false, path: args.remember ? approve(path) : resolve(path) }
    } catch (err) {
      return { canceled: false, error: `Couldn't save ${path}: ${errorMessage(err)}` }
    }
  },
)

ipcMain.handle('file:writeTo', async (_e, args: { path: string; text: string }) => {
  const abs = resolve(args.path)
  if (!approvedPaths.has(abs)) return { error: 'That file was not opened or saved in this session; use Save As.' }
  try {
    await writeFile(abs, args.text, 'utf8')
    return { path: abs }
  } catch (err) {
    return { error: `Couldn't save ${abs}: ${errorMessage(err)}` }
  }
})

ipcMain.handle('file:savePng', async (e, args: { defaultName: string; dataUrl: string }) => {
  let path = testDialogs?.save ? testDialogs.save.replace(/\.[^.\\/]+$/, '') + '.png' : undefined
  if (!path) {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export PNG',
      defaultPath: args.defaultName,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    path = res.filePath
  }
  try {
    await writeFile(path, Buffer.from(args.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
    return { canceled: false, path: resolve(path) }
  } catch (err) {
    return { canceled: false, error: `Couldn't export ${path}: ${errorMessage(err)}` }
  }
})

ipcMain.handle('app:confirm', async (e, args: { message: string; detail?: string; confirmLabel: string }) => {
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

ipcMain.on('app:setDirty', (e, dirty: boolean) => {
  if (dirty) dirtyWindows.add(e.sender.id)
  else dirtyWindows.delete(e.sender.id)
})

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
