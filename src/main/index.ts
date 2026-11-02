import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { scanRepository } from './repo-scan'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

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

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/* ------------------------------- IPC ------------------------------- */

ipcMain.handle('repo:pickAndScan', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Choose a repository folder to map',
    properties: ['openDirectory'],
  })
  if (res.canceled || res.filePaths.length === 0) return { canceled: true }
  const dir = res.filePaths[0]
  const diagram = await scanRepository(dir)
  return { canceled: false, diagram, dir }
})

ipcMain.handle('file:openProject', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Open a Cartographer map',
    filters: [{ name: 'Cartographer / JSON', extensions: ['crtgrphr', 'json'] }],
    properties: ['openFile'],
  })
  if (res.canceled || res.filePaths.length === 0) return { canceled: true }
  const text = await readFile(res.filePaths[0], 'utf8')
  return { canceled: false, text, path: res.filePaths[0] }
})

ipcMain.handle(
  'file:save',
  async (_e, args: { defaultName: string; text: string; filters?: Electron.FileFilter[] }) => {
    const res = await dialog.showSaveDialog({ title: 'Save', defaultPath: args.defaultName, filters: args.filters })
    if (res.canceled || !res.filePath) return { canceled: true }
    await writeFile(res.filePath, args.text, 'utf8')
    return { canceled: false, path: res.filePath }
  },
)

ipcMain.handle('file:savePng', async (_e, args: { defaultName: string; dataUrl: string }) => {
  const res = await dialog.showSaveDialog({
    title: 'Export PNG',
    defaultPath: args.defaultName,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  })
  if (res.canceled || !res.filePath) return { canceled: true }
  const base64 = args.dataUrl.replace(/^data:image\/png;base64,/, '')
  await writeFile(res.filePath, Buffer.from(base64, 'base64'))
  return { canceled: false, path: res.filePath }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
