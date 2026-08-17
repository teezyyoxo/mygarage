import { useMemo, useState } from 'react'
import { ArrowRightLeft, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Chip, Mono } from './ui'

export interface HubCandidate {
  source: Record<string, unknown>
  classification: string
  confidence: number
  reason: string
  matches: Array<Record<string, unknown>>
  linkedTargetId?: string
  allowedDecisions: string[]
}

export interface HubReview {
  reviewId: string
  expiresAt: string
  direction: string
  vehicleVin: string
  candidates: HubCandidate[]
}

export interface HubDecision {
  sourceId: string
  decision: string
  targetId?: string
}

interface Props {
  review: HubReview
  applying: boolean
  onClose: () => void
  onApply: (decisions: HubDecision[]) => void
}

function targetId(value: Record<string, unknown> | undefined): string {
  return String(value?.targetId ?? value?.id ?? value?.externalId ?? '')
}

export default function VehicleHubReviewModal({ review, applying, onClose, onApply }: Props) {
  const { t } = useTranslation('vehicles')
  const decisionLabels: Record<string, string> = {
    create: t('serviceList.vehicleHub.decisions.create'),
    update_linked: t('serviceList.vehicleHub.decisions.updateLinked'),
    merge: t('serviceList.vehicleHub.decisions.merge'),
    replace: t('serviceList.vehicleHub.decisions.replace'),
    keep_both: t('serviceList.vehicleHub.decisions.keepBoth'),
    link_without_changes: t('serviceList.vehicleHub.decisions.linkWithoutChanges'),
    ignore_once: t('serviceList.vehicleHub.decisions.ignoreOnce'),
    never_sync: t('serviceList.vehicleHub.decisions.neverSync'),
  }
  const classificationLabels: Record<string, string> = {
    unique: t('serviceList.vehicleHub.classifications.unique'),
    'exact-duplicate': t('serviceList.vehicleHub.classifications.exactDuplicate'),
    'possible-duplicate': t('serviceList.vehicleHub.classifications.possibleDuplicate'),
    'linked-update': t('serviceList.vehicleHub.classifications.linkedUpdate'),
    'linked-unchanged': t('serviceList.vehicleHub.classifications.linkedUnchanged'),
    excluded: t('serviceList.vehicleHub.classifications.excluded'),
  }
  const actionable = useMemo(
    () => review.candidates.filter((candidate) => candidate.allowedDecisions.length > 0),
    [review.candidates]
  )
  const [choices, setChoices] = useState<Record<string, HubDecision>>(() =>
    Object.fromEntries(review.candidates.map((candidate) => {
      const sourceId = String(candidate.source.externalId ?? '')
      const decision = candidate.classification === 'unique'
        ? 'create'
        : candidate.classification === 'linked-update'
          ? 'update_linked'
          : ''
      return [sourceId, {
        sourceId,
        decision,
        targetId: candidate.linkedTargetId || targetId(candidate.matches[0]) || undefined,
      }]
    }))
  )
  const ready = actionable.length > 0 && actionable.every(
    (candidate) => choices[String(candidate.source.externalId ?? '')]?.decision
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" role="presentation">
      <section className="flex max-h-[calc(100dvh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-card border border-border bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="vehicle-hub-review-title">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2/70 px-5 py-5 sm:px-7">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
              <ShieldCheck className="h-4 w-4" />
              {t('serviceList.vehicleHub.integrityCheck')}
            </div>
            <h2 id="vehicle-hub-review-title" className="text-xl font-semibold text-text">
              {t('serviceList.vehicleHub.sendTitle')}
            </h2>
            <p className="mt-1 text-sm text-text-mute">
              {t('serviceList.vehicleHub.zeroWrites')}
            </p>
          </div>
          <Chip tone="info">{actionable.length} {t('serviceList.vehicleHub.needDecision')}</Chip>
        </header>

        <div className="space-y-3 overflow-y-auto px-5 py-4 sm:px-7">
          {review.candidates.map((candidate) => {
            const sourceId = String(candidate.source.externalId ?? '')
            const choice = choices[sourceId]
            const selectedMatch = candidate.matches.find((item) => targetId(item) === choice?.targetId) ?? candidate.matches[0]
            return (
              <article key={sourceId} className="grid gap-4 rounded-card border border-border bg-bg/40 p-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(250px,0.9fr)] lg:items-center">
                <div className="min-w-0">
                  <div className="truncate font-medium text-text">{String(candidate.source.type ?? t('serviceList.vehicleHub.serviceEvent'))}</div>
                  <Mono size="sm">{String(candidate.source.date ?? t('serviceList.vehicleHub.noDate'))}{candidate.source.mileage != null ? ` · ${Number(candidate.source.mileage).toLocaleString()} mi` : ''}</Mono>
                  <p className="mt-1 text-xs text-text-mute">{candidate.reason}</p>
                </div>
                <Chip tone={candidate.classification.includes('duplicate') ? 'warning' : 'info'}>
                  {classificationLabels[candidate.classification] ?? candidate.classification}
                </Chip>
                {candidate.allowedDecisions.length ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-text-mute">
                      {t('serviceList.vehicleHub.decision')}
                      <select className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text" value={choice?.decision ?? ''} onChange={(event) => setChoices((current) => ({ ...current, [sourceId]: { ...current[sourceId], sourceId, decision: event.target.value } }))}>
                        <option value="" disabled>{t('serviceList.vehicleHub.selectDecision')}</option>
                        {candidate.allowedDecisions.map((decision) => <option key={decision} value={decision}>{decisionLabels[decision] ?? decision}</option>)}
                      </select>
                    </label>
                    {candidate.matches.length > 1 && ['merge', 'replace', 'link_without_changes'].includes(choice?.decision ?? '') && (
                      <label className="block text-xs font-medium text-text-mute">
                        {t('serviceList.vehicleHub.target')}
                        <select className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text" value={choice?.targetId ?? ''} onChange={(event) => setChoices((current) => ({ ...current, [sourceId]: { ...current[sourceId], targetId: event.target.value } }))}>
                          {candidate.matches.map((item) => <option key={targetId(item)} value={targetId(item)}>{String(item.type ?? t('serviceList.vehicleHub.record'))} · {String(item.date ?? t('serviceList.vehicleHub.noDate'))}</option>)}
                        </select>
                      </label>
                    )}
                    {selectedMatch && <p className="text-xs text-text-mute">{t('serviceList.vehicleHub.targetSummary', { type: String(selectedMatch.type ?? t('serviceList.vehicleHub.serviceEvent')), date: String(selectedMatch.date ?? t('serviceList.vehicleHub.noDate')) })}</p>}
                  </div>
                ) : <span className="text-xs text-text-mute">{t('serviceList.vehicleHub.noWrite')}</span>}
              </article>
            )
          })}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-surface-2/70 px-5 py-4 sm:px-7">
          <span className="mr-auto text-xs text-text-mute">{t('serviceList.vehicleHub.oneUse')}</span>
          <Button variant="secondary" onClick={onClose} disabled={applying}>{t('common:cancel')}</Button>
          <Button variant="primary" icon={ArrowRightLeft} disabled={!ready || applying} onClick={() => onApply(actionable.map((candidate) => choices[String(candidate.source.externalId ?? '')]))}>
            {applying ? t('serviceList.vehicleHub.applying') : t('serviceList.vehicleHub.apply', { count: actionable.length })}
          </Button>
        </footer>
      </section>
    </div>
  )
}
