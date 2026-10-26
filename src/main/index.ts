import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { ProviderStatus, Session, Settings, StartTurnRequest } from '../shared/types.ts'
import { resetEnvCache, resolveEnv } from './env.ts'
import { Orchestrator } from './orchestrator.ts'
import { PROVIDERS, scanProvider } from './providers.ts'
import { sessionToMarkdown, Store } from './store.ts'

let win: BrowserWindow | null = null
let store: Store
let orchestrator: Orchestrator
let providers: ProviderStatus[] = []
let scanning: Promise<ProviderStatus[]> | null = null

const TITLEBAR = { dark: { color: '#181818', symbolColor: '#cccccc' }, light: { color: '#f8f8f8', symbolColor: '#3b3b3b' } }

function effectiveTheme(s: Settings): 'dark' | 'light' {
  if (s.theme === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return s.theme
}

function createWindow(): void {
  const theme = effectiveTheme(store.getSettings())
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Agenty',
    backgroundColor: TITLEBAR[theme].color,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 10 } }
      : { titleBarOverlay: { ...TITLEBAR[theme], height: 34 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())

  // Bağlantılar uygulama içinde değil, sistem tarayıcısında açılsın.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function scanAll(): Promise<ProviderStatus[]> {
  if (scanning) return scanning
  resetEnvCache()
  scanning = (async () => {
    const env = await resolveEnv()
    const overrides = store.getSettings().providers
    providers = await Promise.all(PROVIDERS.map((p) => scanProvider(p, env, overrides[p.id])))
    return providers
  })().finally(() => {
    scanning = null
  })
  return scanning
}

function registerIpc(): void {
  ipcMain.handle('providers:scan', () => scanAll())
  ipcMain.handle('providers:get', () => (providers.length ? providers : scanAll()))

  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const s = store.updateSettings(patch)
    if (patch.theme && win && process.platform !== 'darwin') {
      win.setTitleBarOverlay({ ...TITLEBAR[effectiveTheme(s)], height: 34 })
    }
    return s
  })

  ipcMain.handle('sessions:list', () => store.list())
  ipcMain.handle('sessions:get', (_e, id: string) => store.get(id) ?? null)
  ipcMain.handle('sessions:create', (_e, cwd?: string) => {
    const s = store.create(cwd ?? store.getSettings().defaultCwd)
    send('sessions:list', store.list())
    return s
  })
  ipcMain.handle('sessions:update', (_e, id: string, patch: Partial<Pick<Session, 'title' | 'pinned' | 'cwd'>>) => {
    const s = store.get(id)
    if (!s) return null
    Object.assign(s, patch)
    store.save(s, true)
    send('sessions:list', store.list())
    return s
  })
  ipcMain.handle('sessions:delete', (_e, id: string) => {
    const s = store.get(id)
    s?.turns.forEach((t) => orchestrator.cancelTurn(id, t.id))
    store.delete(id)
    send('sessions:list', store.list())
  })
  ipcMain.handle('sessions:search', (_e, q: string) => store.search(q))
  ipcMain.handle('sessions:export', async (_e, id: string) => {
    const s = store.get(id)
    if (!s || !win) return null
    const safe = s.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${safe || 'oturum'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, sessionToMarkdown(s), 'utf8')
    return r.filePath
  })

  ipcMain.handle('turn:start', (_e, req: StartTurnRequest) => orchestrator.startTurn(req))
  ipcMain.handle('turn:cancel', (_e, sessionId: string, turnId: string) => orchestrator.cancelTurn(sessionId, turnId))
  ipcMain.handle('turn:continue', (_e, sessionId: string, turnId: string, ok: boolean) =>
    orchestrator.continuePipeline(sessionId, turnId, ok)
  )

  ipcMain.handle('dialog:folder', async (_e, defaultPath?: string) => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p).then(() => undefined))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  store = new Store(join(app.getPath('userData'), 'agenty'))
  orchestrator = new Orchestrator(store, {
    delta: (d) => send('run:delta', d),
    session: (s) => send('session:changed', s),
    list: () => send('sessions:list', store.list())
  })
  registerIpc()
  createWindow()
  void scanAll()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  orchestrator?.cancelAll()
  store?.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
