import type { Page } from '@playwright/test'
import { test, expect } from './helpers/fixtures'
import { TEST_VEHICLE } from './helpers/seed'

const BOTTOM_NAV = 'nav[class~="md:hidden"]'

async function injectIPhoneSafeAreas(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.documentElement
    root.style.setProperty('--app-safe-area-top', '47px')
    root.style.setProperty('--app-safe-area-bottom', '34px')
    root.style.setProperty('--app-safe-area-left', '0px')
    root.style.setProperty('--app-safe-area-right', '0px')
  })
}

async function clearQuickEntryRedirectFlags(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('qe_redirected:')) sessionStorage.removeItem(key)
    }
  })
}

async function saveMobileStartPage(page: Page, quickEntryEnabled: boolean): Promise<void> {
  await page.evaluate(async (enabled) => {
    const csrfToken = sessionStorage.getItem('csrf_token')
    const response = await fetch('/api/auth/me', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken ?? '',
      },
      body: JSON.stringify({ mobile_quick_entry_enabled: enabled }),
    })
    if (!response.ok) throw new Error(`Failed to reset mobile start page: ${response.status}`)
  }, quickEntryEnabled)
}

test.describe('iPhone shell', () => {
  test('Dashboard reserves status-bar and home-indicator safe areas', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
    await page.waitForSelector('header')
    await injectIPhoneSafeAreas(page)

    const headerPadding = await page.locator('header').first().evaluate(
      (element) => getComputedStyle(element).paddingTop,
    )
    const bottomPadding = await page.locator(BOTTOM_NAV).evaluate(
      (element) => getComputedStyle(element).paddingBottom,
    )
    expect(headerPadding).toBe('47px')
    expect(bottomPadding).toBe('34px')

    const navBox = await page.locator(BOTTOM_NAV).boundingBox()
    expect(navBox).not.toBeNull()
    // 64px tab row + 34px safe area, with the 1px top border permitted.
    expect(navBox?.height).toBeGreaterThanOrEqual(98)
    expect((navBox?.y ?? 0) + (navBox?.height ?? 0)).toBe(page.viewportSize()?.height)
  })

  test('all seven tabs stay tappable inside narrow phone viewports', async ({ page }) => {
    await page.goto('/quick-entry')
    await expect(page.getByRole('heading', { name: 'Quick Entry' })).toBeVisible({ timeout: 15000 })

    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      const nav = page.locator(BOTTOM_NAV)
      await expect(nav).toBeVisible()
      const boxes = await nav.locator('a').evaluateAll((links) =>
        links.map((link) => {
          const rect = link.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width, height: rect.height }
        }),
      )

      expect(boxes).toHaveLength(7)
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(width)
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    }

    // Tap a real tab after the geometry assertions. The dev-only React Query
    // button occupies the bottom-right corner in Vite and can cover Settings;
    // it is compiled out of production, but should not make this test flaky.
    await page.locator(`${BOTTOM_NAV} a[href="/address-book"]`).tap()
    await expect(page).toHaveURL(/\/address-book$/)
  })

  test('Quick Entry has safe chrome and a tappable single-vehicle card', async ({ page }) => {
    await page.goto('/quick-entry')
    await expect(page.getByRole('heading', { name: 'Quick Entry' })).toBeVisible({ timeout: 15000 })
    await injectIPhoneSafeAreas(page)

    await expect(page.locator(BOTTOM_NAV)).toBeVisible()
    expect(
      await page.locator('header').evaluate((element) => getComputedStyle(element).paddingTop),
    ).toBe('47px')

    const vehicleLink = page.locator(`a[href="/vehicles/${TEST_VEHICLE.vin}"]`)
    await expect(vehicleLink).toBeVisible()
    await vehicleLink.tap()
    await expect(page).toHaveURL(new RegExp(`/vehicles/${TEST_VEHICLE.vin}$`))
  })

  test('the per-user mobile start-page selection controls the next landing', async ({ page }) => {
    await page.goto('/settings')
    const startPage = page.getByLabel('Mobile start page')
    await expect(startPage).toHaveValue('dashboard')

    try {
      await startPage.selectOption('quick-entry')
      await expect(page.getByText('Mobile preference saved!')).toBeVisible()
      await clearQuickEntryRedirectFlags(page)

      await page.goto('/')
      await expect(page).toHaveURL(/\/quick-entry$/)
    } finally {
      await saveMobileStartPage(page, false)
      await clearQuickEntryRedirectFlags(page)
    }

    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
  })
})
