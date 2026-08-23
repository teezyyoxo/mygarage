import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal, Pause, Play, Trash2 } from 'lucide-react'
import api from '@/services/api'
import { Select } from './ui'

interface LogEntry {
  id: number
  timestamp: string
  level: string
  logger: string
  message: string
}

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
const POLL_INTERVAL_MS = 3000

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: 'text-garage-text-muted',
  INFO: 'text-garage-text',
  WARNING: 'text-warning-500',
  ERROR: 'text-danger-500',
  CRITICAL: 'text-danger-500',
}

/** Live-tails the backend's in-memory log ring buffer (admin only). */
export default function SystemLogsPanel() {
  const { t } = useTranslation('settings')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [loadError, setLoadError] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const lastIdRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paused) return
    let cancelled = false

    const poll = async () => {
      try {
        const { data } = await api.get<{ logs: LogEntry[] }>('/settings/system/logs', {
          params: { limit: 200, after_id: lastIdRef.current || undefined },
        })
        if (cancelled || !data.logs.length) return
        lastIdRef.current = data.logs[data.logs.length - 1].id
        setLogs((prev) => [...prev, ...data.logs].slice(-1000))
        setLoadError(false)
      } catch {
        if (!cancelled) setLoadError(true)
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [paused])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const visibleLogs = levelFilter ? logs.filter((l) => l.level === levelFilter) : logs

  return (
    <div className="bg-garage-surface rounded-lg border border-garage-border p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Terminal className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-garage-text mb-1">{t('systemLogs.title')}</h2>
          <p className="text-sm text-garage-text-muted">{t('systemLogs.description')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          placeholder={t('systemLogs.allLevels')}
          className="w-40"
          options={LEVELS.map((level) => ({ value: level, label: level }))}
        />
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-garage-border hover:bg-garage-bg transition-colors text-garage-text"
        >
          {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          {paused ? t('systemLogs.resume') : t('systemLogs.pause')}
        </button>
        <button
          type="button"
          onClick={() => setLogs([])}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-garage-border hover:bg-garage-bg transition-colors text-garage-text"
        >
          <Trash2 className="w-4 h-4" />
          {t('systemLogs.clear')}
        </button>
        <label className="flex items-center gap-1.5 text-sm text-garage-text-muted">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-4 h-4"
          />
          {t('systemLogs.autoScroll')}
        </label>
        {paused && <span className="text-xs text-garage-text-muted">{t('systemLogs.paused')}</span>}
      </div>

      {loadError && <p className="text-sm text-danger-500">{t('systemLogs.loadError')}</p>}

      <div
        ref={scrollRef}
        className="bg-garage-bg border border-garage-border rounded-lg p-3 h-80 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {visibleLogs.length === 0 ? (
          <p className="text-garage-text-muted">{t('systemLogs.empty')}</p>
        ) : (
          visibleLogs.map((entry) => (
            <div key={entry.id} className="whitespace-pre-wrap break-words">
              <span className="text-garage-text-muted">{entry.timestamp.slice(11, 19)}</span>{' '}
              <span className={`font-semibold ${LEVEL_COLOR[entry.level] ?? 'text-garage-text'}`}>
                {entry.level}
              </span>{' '}
              <span className="text-garage-text-muted">{entry.logger}</span>{' '}
              <span className="text-garage-text">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
