import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api', () => ({
  default: { get: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import api from '@/services/api'
import SystemLogsPanel from '../SystemLogsPanel'

const mockedApi = vi.mocked(api)

describe('SystemLogsPanel access states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockResolvedValue({ data: { logs: [] } })
  })

  it('shows a blurred admin-only card without requesting logs for non-admins', () => {
    render(<SystemLogsPanel locked />)

    expect(screen.getByLabelText('systemLogs.adminOnly')).toBeInTheDocument()
    expect(document.querySelector('.blur-\\[6px\\]')).toBeInTheDocument()
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('loads the 1000-line tail directly for an admin', async () => {
    render(<SystemLogsPanel />)

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith(
      '/settings/system/logs',
      { params: { limit: 1000, after_id: undefined } },
    ))
    expect(screen.queryByLabelText('systemLogs.adminOnly')).not.toBeInTheDocument()
  })
})
