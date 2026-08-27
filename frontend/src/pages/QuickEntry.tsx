import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { Car, Fuel, Wrench, Gauge, ChevronRight, LayoutDashboard } from 'lucide-react'
import { toast } from 'sonner'
import FuelRecordForm from '../components/FuelRecordForm'
import ServiceVisitForm from '../components/ServiceVisitForm'
import OdometerRecordForm from '../components/OdometerRecordForm'
import MobileTabBar from '../components/shell/MobileTabBar'
import { Select } from '../components/ui'
import { useQuickEntryVehicles } from '../hooks/queries/useQuickEntryVehicles'
import { vehicleLabel } from '../utils/vehicleLabel'
import { withBase } from '../utils/basePath'
import type { VehicleType } from '../types/vehicle'

type EntryType = 'fuel' | 'service' | 'odometer' | null

export default function QuickEntry() {
  const { t } = useTranslation('vehicles')
  const { user } = useAuth()
  const [selectedVin, setSelectedVin] = useState<string>('')
  const [entryType, setEntryType] = useState<EntryType>(null)

  // Fetched via TanStack Query so a transient failure retries and refetches on
  // focus instead of leaving a permanent empty screen (#114).
  const { data: vehicles = [], isLoading, isError, isFetching, refetch } = useQuickEntryVehicles()

  // Set user-scoped session flag so returning to "/" renders Dashboard, not another redirect
  useEffect(() => {
    if (user?.id) {
      sessionStorage.setItem(`qe_redirected:${user.id}`, '1')
    }
  }, [user?.id])

  // Auto-select when the account has exactly one vehicle, without clobbering a
  // selection the user already made.
  useEffect(() => {
    if (vehicles.length === 1) {
      setSelectedVin((prev) => prev || vehicles[0].vin)
    }
  }, [vehicles])

  const selectedVehicle = vehicles.find(v => v.vin === selectedVin)

  const handleSuccess = (type: EntryType) => {
    const labels: Record<string, string> = {
      fuel: t('quickEntry.fuelRecord'),
      service: t('quickEntry.serviceVisit'),
      odometer: t('quickEntry.mileage'),
    }
    toast.success(t('quickEntry.recordSaved', { type: labels[type as string] ?? t('quickEntry.record') }))
    setEntryType(null)
  }

  return (
    <div className="min-h-dvh bg-garage-bg flex flex-col pb-[calc(4rem+var(--app-safe-area-bottom))] md:pb-0">
      {/* Minimal header */}
      <header className="sticky top-0 z-nav border-b border-garage-border bg-garage-surface pt-safe-top pl-safe-left pr-safe-right">
        <div className="flex min-h-[52px] items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Car className="w-5 h-5 text-primary" />
            <span className="font-semibold text-garage-text">{t('common:appName')}</span>
          </div>
          <Link
            to="/"
            className="flex min-h-11 items-center gap-1 px-2 text-sm text-primary hover:underline"
          >
            <LayoutDashboard className="w-4 h-4" />
            {t('common:dashboard')}
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <h1 className="text-xl font-bold text-garage-text mb-6">{t('quickEntry.title')}</h1>

        {isLoading && (
          <div className="text-garage-text-muted text-center py-12">{t('quickEntry.loadingVehicles')}</div>
        )}

        {!isLoading && isError && (
          <div className="text-center py-12">
            <p className="text-danger-500 mb-4">{t('quickEntry.loadError')}</p>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="text-primary hover:underline disabled:opacity-50"
            >
              {isFetching ? t('quickEntry.loadingVehicles') : t('quickEntry.retry')}
            </button>
          </div>
        )}

        {!isLoading && !isError && vehicles.length === 0 && (
          <div className="text-center py-12">
            <p className="text-garage-text-muted mb-4">{t('quickEntry.noVehicles')}</p>
            <Link to="/" className="text-primary hover:underline">
              {t('quickEntry.goToDashboard')}
            </Link>
          </div>
        )}

        {!isLoading && !isError && vehicles.length > 0 && (
          <div className="space-y-6">
            {/* Vehicle selector */}
            <div>
              <label className="block text-sm font-medium text-garage-text mb-2">
                {t('quickEntry.vehicle')}
              </label>
              {vehicles.length === 1 ? (
                /* Single vehicle — selected automatically; the whole card opens it. */
                <Link
                  to={`/vehicles/${vehicles[0].vin}`}
                  aria-label={t('quickEntry.viewVehicle', { vehicle: vehicleLabel(vehicles[0]) })}
                  className="ui-focus-ring flex min-h-20 items-center gap-3 rounded-lg border border-garage-border bg-garage-surface p-3 transition-colors hover:border-primary"
                >
                  {selectedVehicle?.thumbnail_url ? (
                    <img
                      src={withBase(selectedVehicle.thumbnail_url)}
                      alt={selectedVehicle.nickname}
                      className="w-12 h-12 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-garage-bg flex items-center justify-center flex-shrink-0">
                      <Car className="w-6 h-6 text-garage-text-muted" />
                    </div>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-garage-text">{vehicleLabel(vehicles[0])}</span>
                    <span className="mt-1 block text-xs text-garage-text-muted">{t('quickEntry.viewVehicleDetails')}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-garage-text-muted" />
                </Link>
              ) : (
                <Select
                  value={selectedVin}
                  onChange={e => setSelectedVin(e.target.value)}
                  placeholder={t('quickEntry.selectVehicle')}
                  options={vehicles.map(v => ({ value: v.vin, label: vehicleLabel(v) }))}
                />
              )}
            </div>

            {/* Action buttons — only shown once a vehicle is selected */}
            {selectedVin && (
              <div>
                <p className="text-sm font-medium text-garage-text mb-3">{t('quickEntry.whatLogging')}</p>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => setEntryType('fuel')}
                    className="flex items-center justify-between w-full px-4 py-4 bg-garage-surface border border-garage-border rounded-lg text-left hover:border-primary transition-colors active:scale-95"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 rounded-lg">
                        <Fuel className="w-5 h-5 text-blue-500" />
                      </div>
                      <div>
                        <div className="font-medium text-garage-text">{t('quickEntry.fuelUp')}</div>
                        <div className="text-xs text-garage-text-muted">{t('quickEntry.fuelUpDesc')}</div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-garage-text-muted" />
                  </button>

                  <button
                    onClick={() => setEntryType('service')}
                    className="flex items-center justify-between w-full px-4 py-4 bg-garage-surface border border-garage-border rounded-lg text-left hover:border-primary transition-colors active:scale-95"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-orange-500/10 rounded-lg">
                        <Wrench className="w-5 h-5 text-orange-500" />
                      </div>
                      <div>
                        <div className="font-medium text-garage-text">{t('quickEntry.serviceVisit')}</div>
                        <div className="text-xs text-garage-text-muted">{t('quickEntry.serviceVisitDesc')}</div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-garage-text-muted" />
                  </button>

                  <button
                    onClick={() => setEntryType('odometer')}
                    className="flex items-center justify-between w-full px-4 py-4 bg-garage-surface border border-garage-border rounded-lg text-left hover:border-primary transition-colors active:scale-95"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/10 rounded-lg">
                        <Gauge className="w-5 h-5 text-green-500" />
                      </div>
                      <div>
                        <div className="font-medium text-garage-text">{t('quickEntry.mileage')}</div>
                        <div className="text-xs text-garage-text-muted">{t('quickEntry.mileageDesc')}</div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-garage-text-muted" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal forms — opened by action buttons */}
      {entryType === 'fuel' && selectedVin && (
        <FuelRecordForm
          vin={selectedVin}
          onClose={() => setEntryType(null)}
          onSuccess={() => handleSuccess('fuel')}
        />
      )}

      {entryType === 'service' && selectedVin && (
        <ServiceVisitForm
          vin={selectedVin}
          vehicleType={selectedVehicle?.vehicle_type as VehicleType | undefined}
          onClose={() => setEntryType(null)}
          onSuccess={() => handleSuccess('service')}
        />
      )}

      {entryType === 'odometer' && selectedVin && (
        <OdometerRecordForm
          vin={selectedVin}
          onClose={() => setEntryType(null)}
          onSuccess={() => handleSuccess('odometer')}
        />
      )}

      <MobileTabBar />
    </div>
  )
}
