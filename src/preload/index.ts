import { contextBridge, ipcRenderer } from 'electron'
import type { IRDiagram } from '../shared/ir'

export interface AiSettingsShape {
  provider: 'ollama' | 'anthropic'
  ollamaUrl: string
  ollamaModel: string
  anthropicModel: string
}
export type KeyStatus = 'saved' | 'session' | 'none'

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
    /** Re-scan a map's folder (asks the user to confirm folders not picked this session). */
    rescan: (root: string): Promise<{ canceled: boolean; diagram?: IRDiagram; dir?: string; error?: string }> =>
      ipcRenderer.invoke('repo:rescan', { root }),
  },
  file: {
    openProject: (): Promise<FileResult & { text?: string }> => ipcRenderer.invoke('file:openProject'),
    /** Open a map from the recent list (map files only). */
    openPath: (path: string): Promise<{ text?: string; path?: string; error?: string; missing?: boolean }> =>
      ipcRenderer.invoke('file:openPath', { path }),
    /** Save via a dialog. `remember` lets later plain Saves write there directly. */
    saveAs: (args: { defaultName: string; text: string; filters?: SaveFilter[]; remember?: boolean }): Promise<FileResult> =>
      ipcRenderer.invoke('file:saveAs', args),
    /** Save to a path the user already chose in this session (no dialog). */
    writeTo: (args: { path: string; text: string }): Promise<{ path?: string; error?: string }> =>
      ipcRenderer.invoke('file:writeTo', args),
    savePng: (args: { defaultName: string; dataUrl: string }): Promise<FileResult> =>
      ipcRenderer.invoke('file:savePng', args),
  },
  shell: {
    /** Reveal `rel` (relative to the map's `root`) in the file manager. */
    reveal: (root: string, rel: string): Promise<{ path?: string; error?: string }> => ipcRenderer.invoke('shell:reveal', { root, rel }),
  },
  ai: {
    getSettings: (): Promise<{ settings: AiSettingsShape; key: KeyStatus; encryption: boolean }> => ipcRenderer.invoke('ai:getSettings'),
    saveSettings: (settings: AiSettingsShape): Promise<{ settings: AiSettingsShape }> => ipcRenderer.invoke('ai:saveSettings', settings),
    /** Store the Anthropic key in the main process (null removes it). It is never sent back. */
    setKey: (key: string | null): Promise<{ key: KeyStatus; persisted: boolean }> => ipcRenderer.invoke('ai:setKey', key),
    test: (): Promise<{ message?: string; error?: string }> => ipcRenderer.invoke('ai:test'),
    generate: (args: {
      description: string
      type?: string
    }): Promise<{ diagram?: IRDiagram; fixes?: string[]; attempts?: number; provider?: string; error?: string }> =>
      ipcRenderer.invoke('ai:generate', args),
  },
  app: {
    confirm: (args: { message: string; detail?: string; confirmLabel: string }): Promise<boolean> =>
      ipcRenderer.invoke('app:confirm', args),
    setDirty: (dirty: boolean): void => ipcRenderer.send('app:setDirty', dirty),
  },
}

export type CartographApi = typeof api

contextBridge.exposeInMainWorld('cartographer', api)
