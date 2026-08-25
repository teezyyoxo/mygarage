import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from 'lucide-react'
import api from '@/services/api'

interface LogEntry {
  id: number
  timestamp: string
  level: string
  logger: string
  message: string
}

const POLL_INTERVAL_MS = 3000

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: 'text-garage-text-muted',
  INFO: 'text-garage-text',
  WARNING: 'text-warning-500',
  ERROR: 'text-danger-500',
  CRITICAL: 'text-danger-500',
}

/** Read-only live view of the backend's most recent 1,000 log lines. */
export default function SystemLogsPanel({ locked = false }: { locked?: boolean }) {
  const { t } = useTranslation('settings')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loadError, setLoadError] = useState(false)
  const lastIdRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (locked) return
    let cancelled = false

    const poll = async () => {
      try {
        const { data } = await api.get<{ logs: LogEntry[] }>('/settings/system/logs', {
          params: { limit: 1000, after_id: lastIdRef.current || undefined },
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
  }, [locked])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const placeholderLogs: LogEntry[] = Array.from({ length: 9 }, (_, index) => ({
    id: index,
    timestamp: '2026-08-24T12:00:00Z',
    level: index % 4 === 0 ? 'WARNING' : 'INFO',
    logger: 'mygarage.system',
    message: t('systemLogs.protectedPlaceholder'),
  }))
  const displayedLogs = locked ? placeholderLogs : logs

  return (
    <div className="relative overflow-hidden bg-garage-surface rounded-lg border border-garage-border">
      <div
        className={`p-6 space-y-4 ${locked ? 'pointer-events-none select-none blur-[6px] opacity-55' : ''}`}
        aria-hidden={locked || undefined}
      >
        <div className="flex items-start gap-3">
          <Terminal className="w-6 h-6 text-primary mt-1" />
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-garage-text mb-1">
              {t('systemLogs.title')}
            </h2>
            <p className="text-sm text-garage-text-muted">{t('systemLogs.description')}</p>
          </div>
        </div>

        {loadError && <p className="text-sm text-danger-500">{t('systemLogs.loadError')}</p>}

        <div
          ref={scrollRef}
          className="bg-garage-bg border border-garage-border rounded-lg p-3 h-80 overflow-y-auto font-mono text-xs leading-relaxed"
        >
          {displayedLogs.length === 0 ? (
            <p className="text-garage-text-muted">{t('systemLogs.empty')}</p>
          ) : (
            displayedLogs.map((entry) => (
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
      {locked && (
        <div
          className="absolute inset-0 z-10 grid place-items-center bg-garage-bg/25"
          role="note"
          aria-label={t('systemLogs.adminOnly')}
        >
          <span className="rounded-full border border-garage-border bg-garage-surface/95 px-5 py-2.5 text-sm font-bold uppercase tracking-[.12em] text-garage-text shadow-xl backdrop-blur-none">
            {t('systemLogs.adminOnly')}
          </span>
        </div>
      )}
    </div>
  )
}
