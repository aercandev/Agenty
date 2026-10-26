import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Settings } from '@shared/types'
import { CommandPalette, type Command } from './components/CommandPalette'
import { Composer, type ComposerHandle } from './components/Composer'
import { Icon, Spinner } from './components/Icon'
import { SessionView } from './components/SessionView'
import { SettingsView } from './components/SettingsView'
import { SetupWizard } from './components/SetupWizard'
import { ProvidersPanel, SearchPanel, SessionsPanel, type SideView } from './components/Sidebar'
import { useAppData } from './state'
import { api, cx, isReady, MODE_LABELS, shortPath } from './util'

type Page = 'session' | 'settings'

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export function App() {
  const data = useAppData()
  const { settings, providers, sessions, current } = data
  const [side, setSide] = useState<SideView>('sessions')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [page, setPage] = useState<Page>('session')
  const [palette, setPalette] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)
  const [draftCwd, setDraftCwd] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const composer = useRef<ComposerHandle>(null)
  const systemDark = useSystemDark()

  useEffect(() => {
    if (settings && !settings.setupComplete) setWizard(true)
  }, [settings?.setupComplete]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const theme = settings?.theme === 'system' ? (systemDark ? 'dark' : 'light') : (settings?.theme ?? 'dark')
  const cwd = current?.cwd ?? draftCwd ?? settings?.defaultCwd ?? ''
  const activeTurn = current?.turns.find((t) => t.status === 'running' || t.status === 'awaiting-approval')
  const runningCount = sessions.filter((s) => s.running).length
  const readyCount = providers.filter(isReady).length

  const openSession = useCallback(
    (id: string) => {
      setPage('session')
      void data.openSession(id)
    },
    [data]
  )

  const newSession = useCallback(() => {
    setPage('session')
    setDraftCwd(null)
    void data.openSession(null)
    setTimeout(() => composer.current?.focus(), 0)
  }, [data])

  const changeSettings = useCallback((patch: Partial<Settings>) => void data.updateSettings(patch), [data])

  const pickCwd = async () => {
    const p = await api.pickFolder(cwd)
    if (!p) return
    if (current) await data.updateSession(current.id, { cwd: p })
    else setDraftCwd(p)
  }

  const send = async (prompt: string) => {
    if (!settings) return
    try {
      const session = current ?? (await data.newSession(cwd))
      await api.startTurn({
        sessionId: session.id,
        prompt,
        mode: settings.mode,
        cwd: session.cwd ?? cwd,
        single: settings.singleModel,
        analysis: settings.analysisModel,
        coding: settings.codingModel,
        parallel: settings.parallelModels,
        codingPermission: settings.codingPermission
      })
    } catch (e) {
      setToast(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const exportSession = async (id: string) => {
    const path = await api.exportSession(id)
    if (path) setToast(`Dışa aktarıldı: ${path}`)
  }

  const commands: Command[] = useMemo(
    () => [
      { id: 'new', label: 'Yeni oturum', keys: 'Ctrl+N', run: newSession },
      { id: 'settings', label: 'Ayarları aç', keys: 'Ctrl+,', run: () => setPage('settings') },
      { id: 'wizard', label: 'Kurulum sihirbazını çalıştır', run: () => setWizard(true) },
      { id: 'scan', label: "CLI'ları yeniden tara", run: () => void data.rescan() },
      { id: 'sidebar', label: 'Kenar çubuğunu aç/kapat', keys: 'Ctrl+B', run: () => setSidebarOpen((o) => !o) },
      { id: 'search', label: 'Oturumlarda ara', keys: 'Ctrl+Shift+F', run: () => (setSide('search'), setSidebarOpen(true)) },
      { id: 'providers', label: 'Sağlayıcıları göster', run: () => (setSide('providers'), setSidebarOpen(true)) },
      { id: 'mode-single', label: `Mod: ${MODE_LABELS.single}`, keys: 'Alt+1', run: () => changeSettings({ mode: 'single' }) },
      { id: 'mode-pipeline', label: `Mod: ${MODE_LABELS.pipeline}`, keys: 'Alt+2', run: () => changeSettings({ mode: 'pipeline' }) },
      { id: 'mode-parallel', label: `Mod: ${MODE_LABELS.parallel}`, keys: 'Alt+3', run: () => changeSettings({ mode: 'parallel' }) },
      {
        id: 'theme',
        label: 'Temayı değiştir (koyu/açık)',
        run: () => changeSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
      },
      { id: 'folder', label: 'Çalışma klasörünü değiştir', run: () => void pickCwd() },
      ...(current
        ? [
            { id: 'export', label: 'Oturumu Markdown olarak dışa aktar', run: () => void exportSession(current.id) },
            { id: 'pin', label: current.pinned ? 'Oturumun sabitlemesini kaldır' : 'Oturumu sabitle', run: () => void data.updateSession(current.id, { pinned: !current.pinned }) },
            ...(activeTurn ? [{ id: 'stop', label: 'Çalışan görevi durdur', run: () => void api.cancelTurn(current.id, activeTurn.id) }] : [])
          ]
        : [])
    ],
    [newSession, data, changeSettings, theme, current, activeTurn] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && e.shiftKey && k === 'p') (e.preventDefault(), setPalette('>'))
      else if (mod && !e.shiftKey && k === 'p') (e.preventDefault(), setPalette(''))
      else if (mod && k === 'n') (e.preventDefault(), newSession())
      else if (mod && k === 'b') (e.preventDefault(), setSidebarOpen((o) => !o))
      else if (mod && k === ',') (e.preventDefault(), setPage('settings'))
      else if (mod && e.shiftKey && k === 'f') (e.preventDefault(), setSide('search'), setSidebarOpen(true))
      else if (mod && k === 'l') (e.preventDefault(), setPage('session'), composer.current?.focus())
      else if (e.altKey && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault()
        changeSettings({ mode: (['single', 'pipeline', 'parallel'] as const)[Number(e.key) - 1] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newSession, changeSettings])

  // Kenar çubuğu genişliğini sürükleyerek ayarla.
  const startResize = (e: ReactMouseEvent) => {
    if (!settings) return
    const startX = e.clientX
    const startW = settings.sidebarWidth
    let w = startW
    const move = (ev: MouseEvent) => {
      w = Math.min(520, Math.max(200, startW + ev.clientX - startX))
      document.documentElement.style.setProperty('--sidebar-w', `${w}px`)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing')
      changeSettings({ sidebarWidth: w })
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!settings) {
    return (
      <div className={cx('app boot', `theme-${theme}`)}>
        <Spinner size={20} />
      </div>
    )
  }

  const activity = (view: SideView) => {
    if (side === view && sidebarOpen) setSidebarOpen(false)
    else {
      setSide(view)
      setSidebarOpen(true)
    }
  }

  return (
    <div
      className={cx('app', `theme-${theme}`, `platform-${api.platform}`)}
      style={{ ['--sidebar-w' as string]: `${settings.sidebarWidth}px`, ['--font-size' as string]: `${settings.fontSize}px` }}
    >
      <header className="titlebar">
        <div className="titlebar-left">
          <span className="logo small">A</span>
          <span className="app-name">Agenty</span>
        </div>
        <button className="command-center" onClick={() => setPalette('')}>
          <Icon name="search" size={13} />
          <span>{page === 'settings' ? 'Ayarlar' : current ? current.title : 'Agenty'}</span>
          <kbd>Ctrl+P</kbd>
        </button>
        <div className="titlebar-right" />
      </header>

      <div className="workbench">
        <nav className="activitybar">
          <button className={cx(side === 'sessions' && sidebarOpen && 'active')} title="Oturumlar" onClick={() => activity('sessions')}>
            <Icon name="chat" size={22} />
          </button>
          <button className={cx(side === 'search' && sidebarOpen && 'active')} title="Ara (Ctrl+Shift+F)" onClick={() => activity('search')}>
            <Icon name="search" size={22} />
          </button>
          <button className={cx(side === 'providers' && sidebarOpen && 'active')} title="Yapay zeka CLI'ları" onClick={() => activity('providers')}>
            <Icon name="cpu" size={22} />
            {readyCount > 0 && <span className="activity-badge">{readyCount}</span>}
          </button>
          <div className="spacer" />
          <button className={cx(page === 'settings' && 'active')} title="Ayarlar (Ctrl+,)" onClick={() => setPage(page === 'settings' ? 'session' : 'settings')}>
            <Icon name="settings" size={22} />
          </button>
        </nav>

        {sidebarOpen && (
          <>
            <aside className="sidebar">
              {side === 'sessions' && (
                <SessionsPanel
                  sessions={sessions}
                  currentId={page === 'session' ? current?.id : undefined}
                  onOpen={openSession}
                  onNew={newSession}
                  onRename={(id, title) => void data.updateSession(id, { title })}
                  onPin={(id, pinned) => void data.updateSession(id, { pinned })}
                  onDelete={(id) => void data.deleteSession(id)}
                  onExport={(id) => void exportSession(id)}
                />
              )}
              {side === 'search' && <SearchPanel onOpen={openSession} autoFocus />}
              {side === 'providers' && <ProvidersPanel providers={providers} scanning={data.scanning} onRescan={() => void data.rescan()} />}
            </aside>
            <div className="sash" onMouseDown={startResize} />
          </>
        )}

        <main className="editor">
          {page === 'settings' ? (
            <SettingsView
              settings={settings}
              providers={providers}
              onChange={changeSettings}
              onRunWizard={() => setWizard(true)}
              onRescan={() => void data.rescan()}
            />
          ) : (
            <>
              {current && (
                <div className="editor-head">
                  <Icon name="chat" size={14} />
                  <span className="editor-title">{current.title}</span>
                  <div className="spacer" />
                  <button className="icon-btn" title={current.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'} onClick={() => void data.updateSession(current.id, { pinned: !current.pinned })}>
                    <Icon name="pin" size={14} className={current.pinned ? 'accent' : undefined} />
                  </button>
                  <button className="icon-btn" title="Markdown olarak dışa aktar" onClick={() => void exportSession(current.id)}>
                    <Icon name="download" size={14} />
                  </button>
                  <button className="icon-btn" title="Klasörü aç" onClick={() => void api.openPath(cwd)}>
                    <Icon name="folder" size={14} />
                  </button>
                </div>
              )}
              {current && current.turns.length > 0 ? (
                <SessionView session={current} providers={providers} />
              ) : (
                <Welcome readyCount={readyCount} total={providers.length} scanning={data.scanning} onProviders={() => activity('providers')} />
              )}
              <Composer
                ref={composer}
                settings={settings}
                providers={providers}
                cwd={cwd}
                running={!!activeTurn}
                onCwdChange={() => void pickCwd()}
                onSettings={changeSettings}
                onSend={(p) => void send(p)}
                onStop={() => current && activeTurn && void api.cancelTurn(current.id, activeTurn.id)}
              />
            </>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <button onClick={() => activity('providers')} title="Hazır CLI sayısı">
          {data.scanning ? <Spinner size={11} /> : <Icon name="zap" size={12} />} {readyCount}/{providers.length} CLI hazır
        </button>
        {runningCount > 0 && (
          <span>
            <Spinner size={11} /> {runningCount} oturum çalışıyor
          </span>
        )}
        <div className="spacer" />
        <button onClick={() => void pickCwd()} title={cwd}>
          <Icon name="folder" size={12} /> {shortPath(cwd)}
        </button>
        <button onClick={() => setPalette('>Mod')}>{MODE_LABELS[settings.mode]}</button>
        <button title="Tema" onClick={() => changeSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}>
          <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={12} />
        </button>
      </footer>

      {palette !== null && (
        <CommandPalette initial={palette} commands={commands} sessions={sessions} onOpenSession={openSession} onClose={() => setPalette(null)} />
      )}
      {wizard && (
        <SetupWizard
          settings={settings}
          providers={providers}
          scanning={data.scanning}
          onRescan={data.rescan}
          onFinish={(patch) => {
            changeSettings(patch)
            setWizard(false)
          }}
          onClose={settings.setupComplete ? () => setWizard(false) : undefined}
        />
      )}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          <Icon name="info" size={14} /> {toast}
        </div>
      )}
    </div>
  )
}

function Welcome({ readyCount, total, scanning, onProviders }: { readyCount: number; total: number; scanning: boolean; onProviders(): void }) {
  return (
    <div className="welcome">
      <div className="welcome-logo">A</div>
      <h1>Agenty</h1>
      <p className="muted">Birden fazla yapay zeka ajanını tek yerden yönet.</p>
      <button className="welcome-status" onClick={onProviders}>
        {scanning ? <Spinner size={12} /> : <span className={cx('status-dot', readyCount ? 'ok' : 'warn')} />}
        {scanning ? 'CLI taranıyor…' : `${readyCount}/${total} CLI kullanıma hazır`}
      </button>
      <div className="shortcuts">
        <div>
          <span>Yeni oturum</span>
          <kbd>Ctrl+N</kbd>
        </div>
        <div>
          <span>Oturum aç</span>
          <kbd>Ctrl+P</kbd>
        </div>
        <div>
          <span>Komutlar</span>
          <kbd>Ctrl+Shift+P</kbd>
        </div>
        <div>
          <span>Mod değiştir</span>
          <kbd>Alt+1/2/3</kbd>
        </div>
        <div>
          <span>Kenar çubuğu</span>
          <kbd>Ctrl+B</kbd>
        </div>
      </div>
    </div>
  )
}
