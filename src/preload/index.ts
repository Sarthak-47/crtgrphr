import { contextBridge, ipcRenderer } from 'electron'
import type { IRDiagram } from '../shared/ir'

export interface SaveFilter {
  name: string
  extensions: string[]
}

const api = {
  repo: {
    pickAndScan: (): Promise<{ canceled: boolean; diagram?: IRDiagram; dir?: string }> =>
      ipcRenderer.invoke('repo:pickAndScan'),
  },
  file: {
    openProject: (): Promise<{ canceled: boolean; text?: string; path?: string }> =>
      ipcRenderer.invoke('file:openProject'),
    save: (args: {
      defaultName: string
      text: string
      filters?: SaveFilter[]
    }): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('file:save', args),
    savePng: (args: {
      defaultName: string
      dataUrl: string
    }): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('file:savePng', args),
  },
}

export type CartographApi = typeof api

contextBridge.exposeInMainWorld('cartographer', api)
