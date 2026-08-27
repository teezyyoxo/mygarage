import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MobileTabBar from '../MobileTabBar'

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileTabBar />
    </MemoryRouter>
  )
}

describe('MobileTabBar', () => {
  it('renders all seven mobile-label links with their routes', () => {
    at('/')
    const expected: Array<[string, string]> = [
      ['nav:home', '/'],
      ['nav:contacts', '/address-book'],
      ['nav:supplies', '/supplies'],
      ['nav:poi', '/poi-finder'],
      ['nav:calendar', '/calendar'],
      ['nav:analytics', '/analytics'],
      ['nav:settings', '/settings'],
    ]
    for (const [name, href] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
    }
  })

  it('applies the retokenized accent active class on the current route', () => {
    at('/supplies')
    expect(screen.getByRole('link', { name: 'nav:supplies' })).toHaveClass(
      'text-(--accent-fg)',
      'bg-(--accent-soft)'
    )
  })

  it('does not apply the active class to a non-current route', () => {
    at('/supplies')
    expect(screen.getByRole('link', { name: 'nav:home' })).not.toHaveClass('bg-(--accent-soft)')
  })

  it('consumes the iPhone bottom and landscape safe areas', () => {
    at('/')
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveClass('pb-safe-bottom', 'pl-safe-left', 'pr-safe-right')
  })

  it('uses seven shrinkable columns instead of overflowing fixed-width tabs', () => {
    at('/')
    const nav = screen.getByRole('navigation')
    expect(nav.firstElementChild).toHaveClass('grid', 'grid-cols-7')
    expect(nav.firstElementChild).not.toHaveClass('gap-0.5', 'px-1')
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('min-w-0')
      expect(link).not.toHaveClass('min-w-[56px]')
    }
  })
})
