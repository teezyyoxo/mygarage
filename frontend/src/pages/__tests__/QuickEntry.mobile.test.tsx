import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const queryMock = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 42 } }),
}))

vi.mock('../../hooks/queries/useQuickEntryVehicles', () => ({
  useQuickEntryVehicles: () => queryMock.result,
}))

vi.mock('../../components/FuelRecordForm', () => ({ default: () => null }))
vi.mock('../../components/ServiceVisitForm', () => ({ default: () => null }))
vi.mock('../../components/OdometerRecordForm', () => ({ default: () => null }))

import QuickEntry from '../QuickEntry'

const accord = {
  vin: '1HGCR2F3XEA192408',
  nickname: 'Accord',
  year: 2014,
  make: 'Honda',
  model: 'Accord',
  vehicle_type: 'Car',
  thumbnail_url: null,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/quick-entry']}>
      <Routes>
        <Route path="/quick-entry" element={<QuickEntry />} />
        <Route path="/vehicles/:vin" element={<div>Vehicle details destination</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('QuickEntry mobile shell', () => {
  beforeEach(() => {
    sessionStorage.clear()
    queryMock.result = {
      data: [accord],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }
  })

  it('renders safe-area chrome and the full bottom navigation', () => {
    renderPage()

    expect(screen.getByRole('banner')).toHaveClass('pt-safe-top', 'pl-safe-left', 'pr-safe-right')
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveClass('pb-safe-bottom', 'pl-safe-left', 'pr-safe-right')
    expect(screen.getAllByRole('link').filter((link) => link.closest('nav'))).toHaveLength(7)
  })

  it('makes the auto-selected single vehicle card tappable', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('link', { name: 'quickEntry.viewVehicle' }))
    expect(await screen.findByText('Vehicle details destination')).toBeInTheDocument()
  })

  it('keeps the native selector usable when more than one vehicle is available', async () => {
    queryMock.result = {
      ...queryMock.result,
      data: [
        accord,
        { ...accord, vin: 'WBAJA5C30HG895400', nickname: 'BMW', year: 2017, make: 'BMW', model: '530i' },
      ],
    }
    renderPage()

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'WBAJA5C30HG895400' } })
    expect(select).toHaveValue('WBAJA5C30HG895400')
    expect(await screen.findByText('quickEntry.fuelUp')).toBeInTheDocument()
  })

  it('records the user-scoped session escape flag', async () => {
    renderPage()
    await waitFor(() => expect(sessionStorage.getItem('qe_redirected:42')).toBe('1'))
  })
})
