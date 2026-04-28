import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile suite — runs on Pixel 5 (393×851) and iPhone 13 (390×844).
 * Walks every route, taps every rail item ("tab"), and exercises the
 * interactive sub-controls each page exposes (filter chips, expiration
 * strip, mode toggle, event filters, HALT button, command palette).
 *
 * Overflow check: document.scrollWidth must not exceed viewport + 2px.
 * Tolerance is intentional — sub-pixel rounding can add 1px without
 * actually scrolling.
 */

type Route = { path: string; revamped: boolean; titleRe?: RegExp };

const ROUTES: Route[] = [
  { path: '/',              revamped: true,  titleRe: /Today/i },
  { path: '/scanner',       revamped: true,  titleRe: /Scanner/i },
  { path: '/options-chain', revamped: true,  titleRe: /CIFR/i },
  { path: '/pricing',       revamped: true,  titleRe: /CIFR/i },
  { path: '/portfolio',     revamped: true,  titleRe: /Portfolio/i },
  { path: '/auto-engine',   revamped: true,  titleRe: /Auto engine/i },
  { path: '/vol-surface',   revamped: false },
  { path: '/sentiment',     revamped: false },
  { path: '/backtest',      revamped: false },
  { path: '/journal',       revamped: false },
  { path: '/execution',     revamped: false },
  { path: '/positions',     revamped: false },
  { path: '/agent',         revamped: false },
  { path: '/risk',          revamped: false },
  { path: '/risk-mgmt',     revamped: false },
  { path: '/strategy',      revamped: false },
  { path: '/replay',        revamped: false },
];

// Rail "tabs" — every left-rail item the user can tap.
const RAIL_ITEMS: { label: string; expectedUrl: RegExp }[] = [
  { label: 'Home',      expectedUrl: /\/$/ },
  { label: 'Scanner',   expectedUrl: /\/scanner$/ },
  { label: 'Chain',     expectedUrl: /\/options-chain/ },
  { label: 'Pricing',   expectedUrl: /\/pricing/ },
  { label: 'Portfolio', expectedUrl: /\/portfolio/ },
  { label: 'Positions', expectedUrl: /\/positions/ },
  { label: 'Risk',      expectedUrl: /\/risk/ },
  { label: 'Auto',      expectedUrl: /\/auto-engine/ },
  { label: 'Backtest',  expectedUrl: /\/backtest/ },
  { label: 'NLP',       expectedUrl: /\/sentiment/ },
  { label: 'Agent',     expectedUrl: /\/agent/ },
];

async function captureErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return pageErrors;
}

async function getOverflow(page: Page): Promise<{ scrollWidth: number; innerWidth: number; overflow: number }> {
  return await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
}

test.describe('mobile — every route renders', () => {
  for (const route of ROUTES) {
    test(`${route.path} renders shell, no pageerror, no body overflow`, async ({ page }) => {
      const pageErrors = await captureErrors(page);
      const resp = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      expect(resp?.status(), `HTTP for ${route.path}`).toBeLessThan(400);

      // Shell elements must render on mobile too.
      await expect(page.locator('.rv-topbar')).toBeVisible({ timeout: 15_000 });

      // Revamped pages have an .rv-h1 we can verify.
      if (route.revamped && route.titleRe) {
        await expect(page.locator('.rv-h1').first()).toBeVisible({ timeout: 10_000 });
      }

      // Body-level horizontal overflow — tolerate ≤2px sub-pixel rounding.
      const o = await getOverflow(page);
      expect(o.overflow, `${route.path} overflow ${o.overflow}px (scrollWidth=${o.scrollWidth} viewport=${o.innerWidth})`).toBeLessThanOrEqual(2);

      expect(pageErrors, `pageerror on ${route.path}: ${pageErrors.join(' | ')}`).toHaveLength(0);
    });
  }
});

test.describe('mobile — left rail navigation (every "tab")', () => {
  for (const item of RAIL_ITEMS) {
    test(`tapping rail item "${item.label}" navigates`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.rv-rail')).toBeVisible();

      const target = page.locator('.rv-rail .item', { hasText: item.label }).first();
      // If rail is collapsed offscreen the click would still hit via locator, but
      // we want the tap to be reachable, so scroll into view first.
      await target.scrollIntoViewIfNeeded();
      await target.click();

      await expect(page).toHaveURL(item.expectedUrl);
      await expect(page.locator('.rv-rail .item.active .rlabel')).toContainText(item.label);
    });
  }
});

test.describe('mobile — top bar', () => {
  test('brand + breadcrumbs visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.rv-brand .name')).toBeVisible();
    await expect(page.locator('.rv-crumbs')).toContainText('Home');
  });

  test('search trigger opens command palette', async ({ page }) => {
    await page.goto('/');
    await page.locator('.rv-search').click();
    await expect(page.locator('.rv-cmd')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.rv-cmd')).toBeHidden();
  });

  test('palette filter + ticker route works on mobile', async ({ page }) => {
    await page.goto('/');
    await page.locator('.rv-search').click();
    await page.locator('.rv-cmd-input').fill('cifr');
    await expect(page.locator('.rv-cmd-item').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/options-chain/);
  });
});

test.describe('mobile — scanner sub-controls', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/scanner'); });

  test('filter chips render', async ({ page }) => {
    await expect(page.getByText('My list · 8')).toBeVisible();
    await expect(page.getByText('Mag 7')).toBeVisible();
    await expect(page.getByText('Mispriced · 23')).toBeVisible();
  });

  test('table rows are reachable by scroll', async ({ page }) => {
    const lastRow = page.locator('.rv-card tbody tr').last();
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeVisible();
  });

  test('hotkey footer copy still present', async ({ page }) => {
    await expect(page.getByText(/open chain/i)).toBeVisible();
  });
});

test.describe('mobile — option chain sub-controls', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/options-chain'); });

  test('expiration strip renders 6 cells with default selection visible', async ({ page }) => {
    // The strip is currently a server-rendered read-only display (no onSelect
    // wired) — verify visibility, count, and that exactly one cell carries .on.
    const exps = page.locator('.rv-expstrip .rv-exp');
    await expect(exps).toHaveCount(6);
    await expect(page.locator('.rv-expstrip .rv-exp.on')).toHaveCount(1);
    // Each cell must be reachable on a phone-width viewport (horizontal scroll OK).
    await exps.last().scrollIntoViewIfNeeded();
    await expect(exps.last()).toBeVisible();
  });

  test('chain table is scrollable to the ATM row', async ({ page }) => {
    const atm = page.locator('.rv-chain tbody tr.atm');
    await atm.scrollIntoViewIfNeeded();
    await expect(atm).toBeVisible();
  });

  test('order ticket SELL button is reachable', async ({ page }) => {
    const ticket = page.locator('.rv-ticket');
    await ticket.scrollIntoViewIfNeeded();
    await expect(ticket).toContainText(/SELL/);
  });
});

test.describe('mobile — pricing sub-controls', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/pricing'); });

  test('mode toggle is visible', async ({ page }) => {
    await expect(page.getByText(/Price from IV/i).first()).toBeVisible();
  });

  test('sliders are reachable', async ({ page }) => {
    const slider = page.locator('.rv-slider').first();
    await slider.scrollIntoViewIfNeeded();
    await expect(slider).toBeVisible();
  });

  test('vol surface still renders 63 cells', async ({ page }) => {
    const cells = page.locator('.rv-surface .c');
    expect(await cells.count()).toBe(63);
  });
});

test.describe('mobile — portfolio sub-controls', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/portfolio'); });

  test('rehedge button is reachable', async ({ page }) => {
    const btn = page.getByText(/Rehedge to Δ 0/i);
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toBeVisible();
  });

  test('positions table can be scrolled to', async ({ page }) => {
    const card = page.locator('.rv-card', { hasText: 'Open positions' });
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('tbody tr')).toHaveCount(4);
  });
});

test.describe('mobile — auto engine sub-controls', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/auto-engine'); });

  test('HALT ALL button is reachable', async ({ page }) => {
    const halt = page.getByText(/HALT ALL/i);
    await halt.scrollIntoViewIfNeeded();
    await expect(halt).toBeVisible();
  });

  test('event filter chips render', async ({ page }) => {
    const card = page.locator('.rv-card', { hasText: 'Event stream' });
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.tools span', { hasText: 'all' })).toBeVisible();
    await expect(card.locator('.tools span', { hasText: 'exec' })).toBeVisible();
  });

  test('guardrails limit bars are reachable', async ({ page }) => {
    const limits = page.locator('.rv-limit').first();
    await limits.scrollIntoViewIfNeeded();
    await expect(limits).toBeVisible();
  });
});
