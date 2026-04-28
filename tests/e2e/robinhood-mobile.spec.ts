import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile-view test for /portfolio and /robinhood on Pixel 5.
 * Verifies account tabs (All / Brokerage / Roth IRA) and the AMKR
 * inferred-opening position appearing on the brokerage tab.
 */

const ROUTES = ['/portfolio', '/robinhood'];

async function captureErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  return { pageErrors, consoleErrors };
}

for (const route of ROUTES) {
  test.describe(`mobile portfolio sweep — ${route}`, () => {
    test(`${route} renders without overflow or pageerror`, async ({ page }) => {
      const { pageErrors } = await captureErrors(page);
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.rv-topbar')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.rv-h1').first()).toBeVisible();

      const o = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        w: window.innerWidth,
      }));
      expect(o.sw - o.w, `${route} horizontal overflow`).toBeLessThanOrEqual(2);
      expect(pageErrors, `pageerror on ${route}: ${pageErrors.join(' | ')}`).toHaveLength(0);
    });

    test(`${route} — rail is reachable and "Robinhood" item taps`, async ({ page }) => {
      await page.goto(route);
      const railItem = page.locator('.rv-rail .item', { hasText: 'Robinhood' }).first();
      await railItem.scrollIntoViewIfNeeded();
      await expect(railItem).toBeVisible();
      await railItem.click();
      await expect(page).toHaveURL(/\/robinhood$/);
    });

    test(`${route} — tables rendered and can be scrolled`, async ({ page }) => {
      await page.goto(route);
      const tables = page.locator('.rv-card table');
      const count = await tables.count();
      expect(count, `${route} has no tables`).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await tables.nth(i).scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      }
    });
  });
}

test.describe('robinhood page specifics', () => {
  test('/robinhood — three account tabs (All / Brokerage / Roth IRA) are tappable', async ({ page }) => {
    await page.goto('/robinhood');
    for (const slug of ['all', 'brokerage', 'roth_ira']) {
      const tab = page.getByTestId(`account-tab-${slug}`);
      await tab.scrollIntoViewIfNeeded();
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('/robinhood — AMKR appears on Brokerage tab with pre-CSV chip', async ({ page }) => {
    await page.goto('/robinhood', { waitUntil: 'domcontentloaded' });
    // Turn off live prices first so fetches aren't blocked on yfinance.
    await page.getByTestId('toggle-live-prices').click();
    await page.getByTestId('account-tab-brokerage').click();
    const holdingsCard = page.locator('.rv-card', { hasText: 'Equity holdings' });
    await holdingsCard.scrollIntoViewIfNeeded();
    // AMKR is near the bottom of the table (pre-CSV rows have cost_basis=0).
    const amkrLink = page.getByTestId('equity-link-AMKR');
    await expect(amkrLink).toBeVisible({ timeout: 15000 });
    const amkrRow = amkrLink.locator('xpath=ancestor::tr').first();
    await amkrRow.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await expect(amkrRow).toContainText('pre-CSV');
    await expect(amkrRow).toContainText('100');
  });

  test('/robinhood — Roth IRA tab shows ≥ 1 equity row and label updates', async ({ page }) => {
    await page.goto('/robinhood');
    await page.getByTestId('toggle-live-prices').click();
    await page.getByTestId('account-tab-roth_ira').click();
    const summaryCard = page.locator('.rv-card', { hasText: 'NAV' }).first();
    await expect(summaryCard).toContainText('Roth IRA', { timeout: 10000 });
    const holdingsCard = page.locator('.rv-card', { hasText: 'Equity holdings' });
    await holdingsCard.scrollIntoViewIfNeeded();
    const rows = await holdingsCard.locator('tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });

  test('/robinhood — Roth IRA surfaces unknown-basis proceeds note', async ({ page }) => {
    await page.goto('/robinhood');
    await page.getByTestId('toggle-live-prices').click();
    await page.getByTestId('account-tab-roth_ira').click();
    const note = page.getByTestId('unknown-basis-note');
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeVisible({ timeout: 10000 });
    await expect(note).toContainText('pre-CSV');
  });

  test('/robinhood — Brokerage tab does not accidentally show only options', async ({ page }) => {
    await page.goto('/robinhood');
    await page.getByTestId('account-tab-brokerage').click();
    const holdingsCard = page.locator('.rv-card', { hasText: 'Equity holdings' });
    await holdingsCard.scrollIntoViewIfNeeded();
    await expect(holdingsCard.locator('tbody tr').first()).toBeVisible();
  });

  test('/robinhood — Re-ingest button triggers POST /api/robinhood/ingest', async ({ page }) => {
    await page.goto('/robinhood');
    const reingest = page.getByTestId('reingest-button');
    await reingest.scrollIntoViewIfNeeded();
    await expect(reingest).toBeEnabled();
    const req = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/api/robinhood/ingest'),
      { timeout: 5000 },
    );
    await reingest.click();
    const sent = await req;
    expect(sent.method()).toBe('POST');
  });

  test('/robinhood — clicking an equity ticker navigates to /stock/<ticker>?from=robinhood', async ({ page }) => {
    await page.goto('/robinhood');
    // Use the All tab so we have a well-known ticker (TTD is top of the Roth IRA list).
    const link = page.getByTestId('equity-link-TTD').first();
    await link.scrollIntoViewIfNeeded();
    await expect(link).toHaveAttribute('href', /^\/stock\/TTD(\?|$)/);
    await link.click();
    await expect(page).toHaveURL(/\/stock\/TTD\?from=robinhood/);
  });

  test('/robinhood — clicking an option underlying navigates to /stock/<ticker>?from=robinhood', async ({ page }) => {
    await page.goto('/robinhood');
    await page.getByTestId('toggle-live-prices').click();
    // Pick a known-present option underlying (HOOD has options on Roth IRA + brokerage).
    const hoodLink = page.getByTestId('option-link-HOOD').first();
    await expect(hoodLink).toBeVisible({ timeout: 15000 });
    await hoodLink.scrollIntoViewIfNeeded();
    await hoodLink.click();
    await expect(page).toHaveURL(/\/stock\/HOOD\?from=robinhood/);
  });

  test('/robinhood — Live prices toggle flips label', async ({ page }) => {
    await page.goto('/robinhood');
    const toggle = page.getByTestId('toggle-live-prices');
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toContainText(/Live prices: (on|off)/);
    const firstLabel = (await toggle.textContent()) || '';
    await toggle.click();
    await expect(toggle).not.toHaveText(firstLabel);
  });
});
