import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive, FileText } from 'lucide-react'
import { useSettings } from '@/contexts/SettingsContext'
import { Toggle } from '@/components/ui'
import api from '@/services/api'

type SettingRecord = {
  key: string
  value: string | null
}

type SettingsResponse = {
  settings: SettingRecord[]
}

export default function SettingsFilesTab() {
  const { t } = useTranslation('settings')
  const [loading, setLoading] = useState(true)
  const { triggerSave, registerSaveHandler, unregisterSaveHandler } = useSettings()
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [formData, setFormData] = useState({
    max_upload_size_mb: '10',
    maintenance_import_save_to_documents: 'true',
    allowed_photo_types: ['jpg', 'jpeg', 'png', 'webp'],
    allowed_attachment_types: ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'],
    window_sticker_enabled: 'true',
    window_sticker_ocr_enabled: 'true',
  })
  const [loadedFormData, setLoadedFormData] = useState<typeof formData | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const response = await api.get('/settings')
      const data: SettingsResponse = response.data

      const settingsMap: Record<string, string> = {}
      data.settings.forEach((setting) => {
        settingsMap[setting.key] = setting.value || ''
      })

      const newFormData = {
        max_upload_size_mb: settingsMap['max_upload_size_mb'] || '10',
        maintenance_import_save_to_documents: settingsMap['maintenance_import_save_to_documents'] || 'true',
        allowed_photo_types: settingsMap['allowed_photo_types']
          ? settingsMap['allowed_photo_types'].split(',')
          : ['jpg', 'jpeg', 'png', 'webp'],
        allowed_attachment_types: settingsMap['allowed_attachment_types']
          ? settingsMap['allowed_attachment_types'].split(',')
          : ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'],
        window_sticker_enabled: settingsMap['window_sticker_enabled'] || 'true',
        window_sticker_ocr_enabled: settingsMap['window_sticker_ocr_enabled'] || 'true',
      }
      setFormData(newFormData)
      setLoadedFormData(newFormData)
    } catch {
      // Removed console.error
      setMessage({ type: 'error', text: t('files.loadError') })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleSave = useCallback(async () => {
    await api.post('/settings/batch', {
      settings: {
        max_upload_size_mb: formData.max_upload_size_mb,
        maintenance_import_save_to_documents: formData.maintenance_import_save_to_documents,
        allowed_photo_types: formData.allowed_photo_types.join(','),
        allowed_attachment_types: formData.allowed_attachment_types.join(','),
        window_sticker_enabled: formData.window_sticker_enabled,
        window_sticker_ocr_enabled: formData.window_sticker_ocr_enabled,
      },
    })
  }, [formData])

  // Register save handler
  useEffect(() => {
    registerSaveHandler('files', handleSave)
    return () => unregisterSaveHandler('files')
  }, [handleSave, registerSaveHandler, unregisterSaveHandler])

  // Auto-save when form data changes (after initial load)
  useEffect(() => {
    if (!loadedFormData) return // Nothing loaded yet

    if (JSON.stringify(formData) !== JSON.stringify(loadedFormData)) {
      triggerSave()
    }
  }, [formData, loadedFormData, triggerSave])

  const togglePhotoType = (type: string) => {
    if (formData.allowed_photo_types.includes(type)) {
      setFormData({
        ...formData,
        allowed_photo_types: formData.allowed_photo_types.filter((t) => t !== type),
      })
    } else {
      setFormData({
        ...formData,
        allowed_photo_types: [...formData.allowed_photo_types, type],
      })
    }
  }

  const toggleAttachmentType = (type: string) => {
    if (formData.allowed_attachment_types.includes(type)) {
      setFormData({
        ...formData,
        allowed_attachment_types: formData.allowed_attachment_types.filter((t) => t !== type),
      })
    } else {
      setFormData({
        ...formData,
        allowed_attachment_types: [...formData.allowed_attachment_types, type],
      })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="text-garage-text-muted">{t('files.loading')}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {message && (
        <div
          className={`p-4 rounded-lg border ${
            message.type === 'success'
              ? 'bg-success-500/10 border-success-500 text-success-500'
              : 'bg-danger-500/10 border-danger-500 text-danger-500'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* File Management — masonry columns so the shorter Window Sticker card
          takes its natural height instead of stretching to match the tall one. */}
      <div className="columns-1 lg:columns-2 gap-6">
        {/* File Management Settings */}
        <div className="bg-garage-surface rounded-lg border border-garage-border p-6 break-inside-avoid mb-6">
          <div className="flex items-start gap-3 mb-6">
            <HardDrive className="w-6 h-6 text-primary mt-1" />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-garage-text mb-2">{t('files.title')}</h2>
              <p className="text-sm text-garage-text-muted">
                {t('files.description')}
              </p>
            </div>
          </div>

          <div className="space-y-6">
          <div>
            <Toggle
              label={t('files.saveMaintenanceImports')}
              checked={formData.maintenance_import_save_to_documents === 'true'}
              onChange={(next) => setFormData({ ...formData, maintenance_import_save_to_documents: next ? 'true' : 'false' })}
            />
            <p className="mt-1 text-sm text-garage-text-muted">
              {t('files.saveMaintenanceImportsDesc')}
            </p>
          </div>

          {/* Max Upload Size */}
          <div>
            <label htmlFor="max_upload_size" className="block text-sm font-medium text-garage-text mb-2">
              {t('files.maxUploadSize')}
            </label>
            <input
              type="number"
              id="max_upload_size"
              value={formData.max_upload_size_mb}
              onChange={(e) => setFormData({ ...formData, max_upload_size_mb: e.target.value })}
              min="1"
              max="100"
              className="w-full px-3 py-2 bg-garage-bg border border-garage-border rounded-lg text-garage-text focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-sm text-garage-text-muted">
              {t('files.maxUploadSizeDesc')}
            </p>
          </div>

                    <div>
            <label className="block text-sm font-medium text-garage-text mb-2">
              {t('files.allowedPhotoTypes')}
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].map((type) => (
                <label
                  key={type}
                  className="flex items-center p-3 bg-garage-bg border border-garage-border rounded-lg cursor-pointer hover:border-primary transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={formData.allowed_photo_types.includes(type)}
                    onChange={() => togglePhotoType(type)}
                    className="w-4 h-4 text-primary bg-garage-bg border-garage-border rounded focus:ring-primary focus:ring-2"
                  />
                  <span className="ml-2 text-sm text-garage-text font-mono">.{type}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-sm text-garage-text-muted">
              {t('files.allowedPhotoTypesDesc')}
            </p>
          </div>

                    <div>
            <label className="block text-sm font-medium text-garage-text mb-2">
              {t('files.allowedAttachmentTypes')}
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'txt'].map((type) => (
                <label
                  key={type}
                  className="flex items-center p-3 bg-garage-bg border border-garage-border rounded-lg cursor-pointer hover:border-primary transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={formData.allowed_attachment_types.includes(type)}
                    onChange={() => toggleAttachmentType(type)}
                    className="w-4 h-4 text-primary bg-garage-bg border-garage-border rounded focus:ring-primary focus:ring-2"
                  />
                  <span className="ml-2 text-sm text-garage-text font-mono">.{type}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-sm text-garage-text-muted">
              {t('files.allowedAttachmentTypesDesc')}
            </p>
          </div>

          {/* Storage Info */}
          <div className="pt-6 border-t border-garage-border">
            <h3 className="text-lg font-medium text-garage-text mb-4">{t('files.storageInfo')}</h3>
            <div className="bg-garage-bg rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <HardDrive className="w-5 h-5 text-primary" />
                <div className="flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-garage-text-muted">{t('files.dataDirectory')}:</span>
                    <span className="text-sm text-garage-text font-mono">/app/data</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <HardDrive className="w-5 h-5 text-primary" />
                <div className="flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-garage-text-muted">{t('files.photosDirectory')}:</span>
                    <span className="text-sm text-garage-text font-mono">/app/data/photos</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <HardDrive className="w-5 h-5 text-primary" />
                <div className="flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-garage-text-muted">{t('files.documentsDirectory')}:</span>
                    <span className="text-sm text-garage-text font-mono">/app/data/documents</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Window Sticker */}
        <div className="bg-garage-surface rounded-lg border border-garage-border p-6 break-inside-avoid mb-6">
          <div className="flex items-start gap-3 mb-6">
            <FileText className="w-6 h-6 text-primary mt-1" />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-garage-text mb-2">{t('files.windowSticker')}</h2>
              <p className="text-sm text-garage-text-muted">
                {t('files.windowStickerDesc')}
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Enable Window Sticker */}
            <div>
              <Toggle
                label={t('files.enableWindowSticker')}
                checked={formData.window_sticker_enabled === 'true'}
                onChange={(next) => setFormData({ ...formData, window_sticker_enabled: next ? 'true' : 'false' })}
              />
              <p className="mt-1 text-sm text-garage-text-muted">
                {t('files.enableWindowStickerDesc')}
              </p>
            </div>

            {/* Enable OCR */}
            <div>
              <Toggle
                label={t('files.enableOCR')}
                checked={formData.window_sticker_ocr_enabled === 'true'}
                disabled={formData.window_sticker_enabled === 'false'}
                onChange={(next) => setFormData({ ...formData, window_sticker_ocr_enabled: next ? 'true' : 'false' })}
              />
              <p className="mt-1 text-sm text-garage-text-muted">
                {t('files.enableOCRDesc')}
              </p>
            </div>

            <div className="bg-garage-bg rounded-lg p-4 border border-garage-border">
              <h3 className="text-sm font-medium text-garage-text mb-2">{t('files.aboutWindowStickers')}</h3>
              <p className="text-sm text-garage-text-muted">
                {t('filesTab.aboutWindowStickersBody')}
              </p>
              <p className="text-sm text-garage-text-muted mt-2">
                <strong>{t('filesTab.supportedFormatsLabel')}</strong> {t('filesTab.supportedFormatsValue')}
              </p>
              <p className="text-sm text-garage-text-muted mt-2">
                <strong>{t('filesTab.noteLabel')}</strong> {t('filesTab.windowStickerVehicleNote')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
