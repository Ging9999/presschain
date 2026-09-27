import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Typed bridge exposed to the renderer as `window.api`. Handlers are wired up in
// the main process; several are stubs for Prompt 1.
const api = {
  tor: {
    getStatus: () => ipcRenderer.invoke('tor:getStatus'),
    newCircuit: () => ipcRenderer.invoke('tor:newCircuit'),
    onProgress: (cb: (progress: number) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, value: number): void => cb(value)
      ipcRenderer.on('tor:progress', listener)
      return () => ipcRenderer.removeListener('tor:progress', listener)
    }
  },
  wallet: {
    create: (data: { passphrase: string }) => ipcRenderer.invoke('wallet:create', data),
    import: (data: { mnemonic: string; passphrase: string }) =>
      ipcRenderer.invoke('wallet:import', data),
    unlock: (data: { passphrase: string }) => ipcRenderer.invoke('wallet:unlock', data),
    lock: () => ipcRenderer.invoke('wallet:lock'),
    exportMnemonic: (data: { passphrase: string }) =>
      ipcRenderer.invoke('wallet:exportMnemonic', data),
    getAddress: () => ipcRenderer.invoke('wallet:getAddress'),
    getBalance: () => ipcRenderer.invoke('wallet:getBalance'),
    getEncryptionPublicKey: () => ipcRenderer.invoke('wallet:getEncryptionPublicKey'),
    exists: () => ipcRenderer.invoke('wallet:exists')
  },
  article: {
    upload: (data: {
      title: string
      summary: string
      body: string
      recipients?: string[]
      makePublic?: boolean
    }) => ipcRenderer.invoke('article:upload', data),
    list: (params?: { offset?: number; limit?: number }) =>
      ipcRenderer.invoke('article:list', params),
    read: (data: { articleId: string | number; cid: string }) =>
      ipcRenderer.invoke('article:read', data),
    getCID: (data: { articleId: number }) => ipcRenderer.invoke('article:getCID', data),
    flag: (data: { articleId: number }) => ipcRenderer.invoke('article:flag', data),
    proposeRemoval: (data: { articleId: number }) =>
      ipcRenderer.invoke('article:proposeRemoval', data)
  },
  ipfs: {
    setup: (data: { email: string }) => ipcRenderer.invoke('ipfs:setup', data),
    status: () => ipcRenderer.invoke('ipfs:status')
  },
  gov: {
    getParams: () => ipcRenderer.invoke('gov:getParams')
  },
  app: {
    deleteAllData: () => ipcRenderer.invoke('app:deleteAllData')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to the renderer only if
// context isolation is enabled, otherwise just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
