import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderStatus, RunDelta, Session, SessionSummary, Settings } from '@shared/types'
import { api } from './util'

export function applyDelta(s: Session, d: RunDelta): Session {
  if (s.id !== d.sessionId) return s
  return {
    ...s,
    turns: s.turns.map((t) =>
      t.id !== d.turnId
        ? t
        : {
            ...t,
            runs: t.runs.map((r) =>
              r.id !== d.runId
                ? r
                : {
                    ...r,
                    ...d.patch,
                    text: d.appendText ? r.text + d.appendText : r.text,
                    events: d.events ? [...r.events, ...d.events] : r.events
                  }
            )
          }
    )
  }
}

export function useAppData() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [scanning, setScanning] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [current, setCurrent] = useState<Session | null>(null)
  const currentId = useRef<string | null>(null)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.listSessions().then(setSessions)
    setScanning(true)
    void api.getProviders().then((p) => {
      setProviders(p)
      setScanning(false)
    })
    const offs = [
      api.onRunDelta((d) => setCurrent((s) => (s ? applyDelta(s, d) : s))),
      api.onSessionChanged((s) => {
        if (s.id === currentId.current) setCurrent(s)
      }),
      api.onSessionsListChanged(setSessions)
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const openSession = useCallback(async (id: string | null) => {
    currentId.current = id
    if (!id) return setCurrent(null)
    const s = await api.getSession(id)
    if (currentId.current === id) setCurrent(s)
  }, [])

  const newSession = useCallback(
    async (cwd?: string) => {
      const s = await api.createSession(cwd)
      currentId.current = s.id
      setCurrent(s)
      return s
    },
    []
  )

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    const next = await api.updateSettings(patch)
    setSettings(next)
    return next
  }, [])

  const rescan = useCallback(async () => {
    setScanning(true)
    try {
      const p = await api.scanProviders()
      setProviders(p)
      return p
    } finally {
      setScanning(false)
    }
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    await api.deleteSession(id)
    if (currentId.current === id) {
      currentId.current = null
      setCurrent(null)
    }
  }, [])

  const updateSession = useCallback(async (id: string, patch: Partial<Pick<Session, 'title' | 'pinned' | 'cwd'>>) => {
    const s = await api.updateSession(id, patch)
    if (s && currentId.current === id) setCurrent(s)
  }, [])

  return {
    settings,
    providers,
    scanning,
    sessions,
    current,
    openSession,
    newSession,
    updateSettings,
    rescan,
    deleteSession,
    updateSession
  }
}

export type AppData = ReturnType<typeof useAppData>
