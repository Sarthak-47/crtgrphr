import { contextBridge, ipcRenderer } from 'electron'
import type { IRDiagram } from '../shared/ir'

export interface SaveFilter {
  name: string
  extensions: string[]
}

/** Every file operation resolves (never rejects): failures come back as `error`. */
type FileResult = { canceled: boolean; path?: string; error?: string }

const api = {
  repo: {
    pickAndScan: (): Promise<{ canceled: boolean; diagram?: IRDiagram; dir?: string; error?: string }> =>
      ipcRenderer.invoke('repo:pickAndScan'),
  },
  file: {
    openProject: (): Promise<FileResult & { text?: string }> => ipcRenderer.invoke('file:openProject'),
    /** Save via a dialog. `remember` lets later plain Saves write there directly. */
    saveAs: (args: { defaultName: string; text: string; filters?: SaveFilter[]; remember?: boolean }): Promise<FileResult> =>
      ipcRenderer.invoke('file:saveAs', args),
    /** Save to a path the user already chose in this session (no dialog). */
    writeTo: (args: { path: string; text: string }): Promise<{ path?: string; error?: string }> =>
      ipcRenderer.invoke('file:writeTo', args),
    savePng: (args: { defaultName: string; dataUrl: string }): Promise<FileResult> =>
      ipcRenderer.invoke('file:savePng', args),
  },
  app: {
    confirm: (args: { message: string; detail?: string; confirmLabel: string }): Promise<boolean> =>
      ipcRenderer.invoke('app:confirm', args),
    setDirty: (dirty: boolean): void => ipcRenderer.send('app:setDirty', dirty),
  },
}

export type CartographApi = typeof api

contextBridge.exposeInMainWorld('cartographer', api)
