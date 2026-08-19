import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  Database,
  HardDrive,
  Trash2,
  RefreshCw,
  FileJson,
  Archive,
} from 'lucide-react'
import api from '@/services/api'
import { getActionErrorMessage } from '@/utils/httpErrorHandler'
import { formatDateTime } from '@/utils/parseAPITimestamp'
import { useTimeFormat } from '@/hooks/useTimeFormat'

interface BackupFile {
  filename: string
  type: 'settings' | 'full'
  size_mb: number
  created: string
  is_safety: boolean
}

interface BackupStats {
  database: {
    size_mb: number
    last_modified: string
    exists: boolean
  }
  settings_backups: {
    count: number
    total_size_mb: number
  }
  full_backups: {
    count: number
    total_size_mb: number
  }
}

interface ImportPreview {
  filename: string
  tables: Array<{ name: string; imported: number; current: number; incoming: number }>
  files: Array<{ path: string; size: number }>
  file_count: number
  record_count: number
}

export default function SettingsBackupTab() {
  const { t } = useTranslation('settings')
  const { timeFormat } = useTimeFormat()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<BackupStats | null>(null)
  const [settingsBackups, setSettingsBackups] = useState<BackupFile[]>([])
  const [fullBackups, setFullBackups] = useState<BackupFile[]>([])
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace' | null>(null)
  const [importStep, setImportStep] = useState<'choose' | 'confirm' | 'preview' | null>(null)
  const [importing, setImporting] = useState(false)
  const [creatingSettings, setCreatingSettings] = useState(false)
  const [creatingFull, setCreatingFull] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const settingsFileInputRef = useRef<HTMLInputElement>(null)
  const fullFileInputRef = useRef<HTMLInputElement>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load stats
      const statsResponse = await api.get('/backup/stats')
      setStats(statsResponse.data)

      // Load backups
      const backupsResponse = await api.get('/backup/list?backup_type=all')
      const allBackups: BackupFile[] = backupsResponse.data.backups || []

      setSettingsBackups(allBackups.filter(b => b.type === 'settings'))
      setFullBackups(allBackups.filter(b => b.type === 'full'))
    } catch {
      setMessage({ type: 'error', text: t('backup.loadError') })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCreateSettingsBackup = async () => {
    setCreatingSettings(true)
    setMessage(null)

    try {
      const response = await api.post('/backup/create')
      setMessage({ type: 'success', text: response.data.message || t('backupTab.createSettingsSuccess') })
      await loadData()
    } catch {
      setMessage({ type: 'error', text: t('backup.createSettingsError') })
    } finally {
      setCreatingSettings(false)
    }
  }

  const handleCreateFullBackup = async () => {
    setCreatingFull(true)
    setMessage(null)

    try {
      const response = await api.post('/backup/create-full')
      setMessage({ type: 'success', text: response.data.message || t('backupTab.createFullSuccess') })
      await loadData()
    } catch {
      setMessage({ type: 'error', text: t('backup.createFullError') })
    } finally {
      setCreatingFull(false)
    }
  }

  const handleDownload = (filename: string) => {
    // Use direct browser download instead of loading into memory via AJAX
    // This provides proper progress indication and doesn't consume browser memory
    const baseUrl = api.defaults.baseURL || ''
    const downloadUrl = `${baseUrl}/backup/download/${encodeURIComponent(filename)}`

    // Create a temporary link and trigger native browser download
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleRestore = async (filename: string, isFullBackup: boolean) => {
    if (isFullBackup) {
      await beginFullImport(filename)
      return
    }
    const confirmMessage = isFullBackup
      ? t('backupTab.confirmRestoreFull')
      : t('backupTab.confirmRestoreSettings')

    if (!confirm(confirmMessage)) {
      return
    }

    setMessage(null)

    try {
      const response = await api.post(`/backup/restore/${filename}`)
      setMessage({
        type: 'success',
        text: response.data.message + (response.data.warning ? ` ${response.data.warning}` : '')
      })

      await loadData()

      if (isFullBackup) {
        setMessage({
          type: 'warning',
          text: t('backupTab.fullRestoreComplete')
        })
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: getActionErrorMessage(err, t('backupTab.restoreAction')) })
    }
  }

  const beginFullImport = async (filename: string) => {
    try {
      const { data } = await api.post('/backup/import/preview', null, { params: { filename } })
      setImportPreview(data)
      setImportMode(null)
      setImportStep('choose')
    } catch (err: unknown) {
      setMessage({ type: 'error', text: getActionErrorMessage(err, t('backupTab.importAction')) })
    }
  }

  const chooseImportMode = (mode: 'merge' | 'replace') => {
    setImportMode(mode)
    setImportStep('confirm')
  }

  const confirmImport = async () => {
    if (!importPreview || !importMode) return
    if (importMode === 'merge') {
      setImportStep('preview')
      return
    }
    await executeImport()
  }

  const executeImport = async () => {
    if (!importPreview || !importMode) return
    setImporting(true)
    try {
      const { data } = await api.post(`/backup/import/${importMode}`, null, { params: { filename: importPreview.filename } })
      setMessage({ type: 'success', text: data.details?.message || t('backupTab.importSuccess') })
      setImportStep(null)
      setImportPreview(null)
      await loadData()
    } catch (err: unknown) {
      setMessage({ type: 'error', text: getActionErrorMessage(err, t('backupTab.importAction')) })
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (filename: string) => {
    if (!confirm(t('backupTab.confirmDelete', { filename }))) {
      return
    }

    try {
      await api.delete(`/backup/${filename}`)
      setMessage({ type: 'success', text: t('backupTab.deleteSuccess', { filename }) })
      await loadData()
    } catch (err: unknown) {
      setMessage({ type: 'error', text: getActionErrorMessage(err, t('backupTab.deleteAction')) })
    }
  }

  const handleUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await api.post('/backup/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      if (file.name.endsWith('.tar.gz')) {
        await loadData()
        await beginFullImport(response.data.backup.filename)
      } else {
        setMessage({ type: 'success', text: response.data.message || t('backupTab.uploadSuccess') })
        await loadData()
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: getActionErrorMessage(err, t('backupTab.uploadAction')) })
    } finally {
      if (settingsFileInputRef.current) settingsFileInputRef.current.value = ''
      if (fullFileInputRef.current) fullFileInputRef.current.value = ''
    }
  }

  const formatDate = (dateString: string): string => {
    return formatDateTime(dateString, timeFormat, { seconds: true })
  }

  const formatSize = (sizeMb: number) => {
    if (sizeMb < 1) {
      return `${(sizeMb * 1024).toFixed(1)} KB`
    }
    return `${sizeMb.toFixed(2)} MB`
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="text-garage-text-muted">{t('backup.loading')}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {message && (
        <div
          className={`p-4 rounded-lg border flex items-start gap-2 ${
            message.type === 'success'
              ? 'bg-success-500/10 border-success-500 text-success-500'
              : message.type === 'warning'
              ? 'bg-warning-500/10 border-warning-500 text-warning-500'
              : 'bg-danger-500/10 border-danger-500 text-danger-500'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 mt-0.5" />
          )}
          <div className="flex-1">{message.text}</div>
          <button
            onClick={() => setMessage(null)}
            className="text-current opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Backup Sections Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ========== SECTION 1: SETTINGS BACKUP ========== */}
        <div className="bg-garage-surface rounded-lg border border-garage-border p-6">
        <div className="flex items-start gap-3 mb-6">
          <FileJson className="w-6 h-6 text-primary mt-1" />
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-garage-text mb-2">{t('backup.settingsBackup')}</h2>
            <p className="text-sm text-garage-text-muted">
              {t('backup.settingsBackupDesc')}
            </p>
          </div>
        </div>

        {/* Database Statistics */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-garage-bg rounded-lg p-4 border border-garage-border">
              <div className="flex items-center gap-2 text-garage-text-muted mb-2">
                <Database className="w-4 h-4" />
                <span className="text-sm font-medium">{t('backup.databaseSize')}</span>
              </div>
              <p className="text-2xl font-bold text-primary">{stats.database.size_mb} MB</p>
            </div>
            <div className="bg-garage-bg rounded-lg p-4 border border-garage-border">
              <div className="flex items-center gap-2 text-garage-text-muted mb-2">
                <FileJson className="w-4 h-4" />
                <span className="text-sm font-medium">{t('backup.settingsBackups')}</span>
              </div>
              <p className="text-2xl font-bold text-primary">{stats.settings_backups.count}</p>
              <p className="text-xs text-garage-text-muted mt-1">
                {t('backupTab.totalSize', { size: formatSize(stats.settings_backups.total_size_mb) })}
              </p>
            </div>
            <div className="bg-garage-bg rounded-lg p-4 border border-garage-border">
              <div className="flex items-center gap-2 text-garage-text-muted mb-2">
                <Database className="w-4 h-4" />
                <span className="text-sm font-medium">{t('backup.lastModified')}</span>
              </div>
              <p className="text-sm font-bold text-primary">
                {stats.database.last_modified ? formatDate(stats.database.last_modified) : t('backup.never')}
              </p>
            </div>
          </div>
        )}

        {/* Create Settings Backup */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleCreateSettingsBackup}
            disabled={creatingSettings}
            className="flex items-center gap-2 px-4 py-2 btn btn-primary rounded-lg transition-colors disabled:opacity-50"
          >
            <Download size={16} />
            {creatingSettings ? t('backup.creatingBackup') : t('backup.createSettingsBackup')}
          </button>
          <button
            onClick={() => settingsFileInputRef.current?.click()}
            className="flex items-center gap-2 btn btn-primary rounded-lg transition-colors"
          >
            <Upload size={16} />
            {t('backup.uploadSettingsBackup')}
          </button>
          <input
            ref={settingsFileInputRef}
            type="file"
            accept=".json"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            className="hidden"
          />
        </div>

        {/* Settings Backup Files Table */}
        {settingsBackups.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-garage-bg border-b border-garage-border">
                <tr>
                  <th className="text-left p-3 text-garage-text font-medium">{t('backup.filename')}</th>
                  <th className="text-left p-3 text-garage-text font-medium">{t('backup.size')}</th>
                  <th className="text-left p-3 text-garage-text font-medium">{t('backup.created')}</th>
                  <th className="text-right p-3 text-garage-text font-medium">{t('backup.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {settingsBackups.map((backup) => (
                  <tr key={backup.filename} className="border-b border-garage-border hover:bg-garage-bg">
                    <td className="p-3 text-garage-text font-mono text-xs">
                      {backup.filename}
                      {backup.is_safety && (
                        <span className="ml-2 px-2 py-0.5 text-xs bg-warning-500/20 text-warning-500 rounded">
                          {t('backupTab.safetyBadge')}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-garage-text-muted">{formatSize(backup.size_mb)}</td>
                    <td className="p-3 text-garage-text-muted">{formatDate(backup.created)}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleDownload(backup.filename)}
                          className="p-1 text-primary hover:bg-primary/10 rounded"
                          title={t('backup.download')}
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={() => handleRestore(backup.filename, false)}
                          className="p-1 text-success-500 hover:bg-success-500/10 rounded"
                          title={t('backup.restore')}
                        >
                          <RefreshCw size={16} />
                        </button>
                        {!backup.is_safety && (
                          <button
                            onClick={() => handleDelete(backup.filename)}
                            className="p-1 text-danger-500 hover:bg-danger-500/10 rounded"
                            title={t('common:delete')}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-garage-text-muted">
            {t('backup.noSettingsBackups')}
          </div>
        )}
        </div>

        {/* ========== SECTION 2: FULL DATA BACKUP ========== */}
        <div className="bg-garage-surface rounded-lg border border-garage-border p-6">
        <div className="flex items-start gap-3 mb-6">
          <Archive className="w-6 h-6 text-warning-500 mt-1" />
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-garage-text mb-2">{t('backup.fullDataBackup')}</h2>
            <p className="text-sm text-garage-text-muted">
              {t('backup.fullDataBackupDesc')}
            </p>
          </div>
        </div>

        {/* Full Backup Statistics */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-garage-bg rounded-lg p-4 border border-garage-border">
              <div className="flex items-center gap-2 text-garage-text-muted mb-2">
                <Archive className="w-4 h-4" />
                <span className="text-sm font-medium">{t('backup.fullBackups')}</span>
              </div>
              <p className="text-2xl font-bold text-warning-500">{stats.full_backups.count}</p>
              <p className="text-xs text-garage-text-muted mt-1">
                {t('backupTab.totalSize', { size: formatSize(stats.full_backups.total_size_mb) })}
              </p>
            </div>
            <div className="bg-garage-bg rounded-lg p-4 border border-garage-border">
              <div className="flex items-center gap-2 text-garage-text-muted mb-2">
                <HardDrive className="w-4 h-4" />
                <span className="text-sm font-medium">{t('backup.dataIncluded')}</span>
              </div>
              <p className="text-sm text-garage-text">
                {t('backupTab.dataIncludedList')}
              </p>
            </div>
          </div>
        )}

        {/* Warning */}
        <div className="bg-warning-500/10 border border-warning-500 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-warning-500 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-warning-500 mb-1">{t('backup.importantInfo')}:</h3>
              <ul className="text-sm text-warning-500/90 space-y-1">
                <li>• {t('backupTab.infoIncludesEverything')}</li>
                <li>• {t('backupTab.infoSizeDepends')}</li>
                <li>• {t('backupTab.infoRestoreOverwrites')}</li>
                <li>• {t('backupTab.infoSafetyBackup')}</li>
                <li>• {t('backupTab.infoRestartRequired')}</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Create Full Backup */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleCreateFullBackup}
            disabled={creatingFull}
            className="flex items-center gap-2 px-4 py-2 btn bg-warning-600 hover:bg-warning-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <Archive size={16} />
            {creatingFull ? t('backup.creatingFullBackup') : t('backup.createFullBackup')}
          </button>
          <button
            onClick={() => fullFileInputRef.current?.click()}
            className="flex items-center gap-2 btn btn-primary rounded-lg transition-colors"
          >
            <Upload size={16} />
            {t('backup.uploadFullBackup')}
          </button>
          <input
            ref={fullFileInputRef}
            type="file"
            accept=".tar.gz"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            className="hidden"
          />
        </div>

        {/* Full Backup Files Table */}
        {fullBackups.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-garage-bg border-b border-garage-border">
                <tr>
                  <th className="text-left p-3 text-garage-text font-medium">{t('backup.filename')}</th>
                  <th className="text-left p-3 text-garage-text font-medium">{t('backup.size')}</th>
                  <th className="text-left p-3 text-garage-text font-medium">{t('backup.created')}</th>
                  <th className="text-right p-3 text-garage-text font-medium">{t('backup.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {fullBackups.map((backup) => (
                  <tr key={backup.filename} className="border-b border-garage-border hover:bg-garage-bg">
                    <td className="p-3 text-garage-text font-mono text-xs">
                      {backup.filename}
                      {backup.is_safety && (
                        <span className="ml-2 px-2 py-0.5 text-xs bg-warning-500/20 text-warning-500 rounded">
                          {t('backupTab.safetyBadge')}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-garage-text-muted">{formatSize(backup.size_mb)}</td>
                    <td className="p-3 text-garage-text-muted">{formatDate(backup.created)}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleDownload(backup.filename)}
                          className="p-1 text-primary hover:bg-primary/10 rounded"
                          title={t('backup.download')}
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={() => handleRestore(backup.filename, true)}
                          className="p-1 text-danger-500 hover:bg-danger-500/10 rounded"
                          title={t('backup.restoreOverwrite')}
                        >
                          <RefreshCw size={16} />
                        </button>
                        {!backup.is_safety && (
                          <button
                            onClick={() => handleDelete(backup.filename)}
                            className="p-1 text-danger-500 hover:bg-danger-500/10 rounded"
                            title={t('common:delete')}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-garage-text-muted">
            {t('backup.noFullBackups')}
          </div>
        )}
        </div>
      </div>
      {importStep && importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="presentation">
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-garage-border bg-garage-surface p-6 shadow-2xl" role="dialog" aria-modal="true">
            {importStep === 'choose' && (
              <>
                <h2 className="text-xl font-semibold text-garage-text">{t('backupTab.importTitle')}</h2>
                <p className="mt-3 text-sm text-garage-text-muted">{t('backupTab.importWarning')}</p>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <button type="button" onClick={() => setImportStep(null)} className="btn btn-secondary">{t('common:cancel')}</button>
                  <button type="button" onClick={() => chooseImportMode('merge')} className="btn btn-primary">{t('backupTab.merge')}</button>
                  <button type="button" onClick={() => chooseImportMode('replace')} className="btn bg-danger-600 text-white">{t('backupTab.replace')}</button>
                </div>
              </>
            )}
            {importStep === 'confirm' && importMode && (
              <>
                <h2 className="text-xl font-semibold text-garage-text">{t('backupTab.areYouSure')}</h2>
                <p className="mt-3 text-sm text-garage-text-muted">{importMode === 'replace' ? t('backupTab.replaceConfirm') : t('backupTab.mergeConfirm')}</p>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => setImportStep('choose')} className="btn btn-secondary">{t('common:cancel')}</button>
                  <button type="button" disabled={importing} onClick={() => void confirmImport()} className="btn btn-primary">{t('backupTab.continue')}</button>
                </div>
              </>
            )}
            {importStep === 'preview' && (
              <>
                <h2 className="text-xl font-semibold text-garage-text">{t('backupTab.mergePreview')}</h2>
                <p className="mt-2 text-sm text-garage-text-muted">{t('backupTab.mergePreviewDesc')}</p>
                <div className="mt-4 max-h-72 overflow-y-auto rounded border border-garage-border">
                  {importPreview.tables.map((table) => (
                    <div key={table.name} className="flex justify-between border-b border-garage-border px-3 py-2 text-sm text-garage-text">
                      <span>{table.name}</span><span className="text-garage-text-muted">{table.incoming} incoming / {table.current} existing</span>
                    </div>
                  ))}
                  <div className="border-b border-garage-border px-3 py-2 text-sm font-medium text-garage-text">
                    {t('backupTab.filesToMerge', { count: importPreview.file_count })}
                  </div>
                  {importPreview.files.map((file) => (
                    <div key={file.path} className="border-b border-garage-border px-3 py-1 text-xs text-garage-text-muted">
                      {file.path}
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => setImportStep(null)} className="btn btn-secondary">{t('common:cancel')}</button>
                  <button type="button" disabled={importing} onClick={() => void executeImport()} className="btn btn-primary">{t('backupTab.confirmMerge')}</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
