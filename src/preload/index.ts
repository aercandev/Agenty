import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentyApi } from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AgentyApi = {
  platform: process.platform,
  scanProviders: () => ipcRenderer.invoke('providers:scan'),
  getProviders: () => ipcRenderer.invoke('providers:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  createSession: (cwd) => ipcRenderer.invoke('sessions:create', cwd),
  updateSession: (id, patch) => ipcRenderer.invoke('sessions:update', id, patch),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  searchSessions: (q) => ipcRenderer.invoke('sessions:search', q),
  exportSession: (id) => ipcRenderer.invoke('sessions:export', id),
  startTurn: (req) => ipcRenderer.invoke('turn:start', req),
  cancelTurn: (sessionId, turnId) => ipcRenderer.invoke('turn:cancel', sessionId, turnId),
  continuePipeline: (sessionId, turnId, ok) => ipcRenderer.invoke('turn:continue', sessionId, turnId, ok),
  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:folder', defaultPath),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onRunDelta: (cb) => on('run:delta', cb),
  onSessionChanged: (cb) => on('session:changed', cb),
  onSessionsListChanged: (cb) => on('sessions:list', cb)
}

contextBridge.exposeInMainWorld('agenty', api)
