import { test, expect } from '@playwright/test';

/**
 * Per-page feature tests — assert the visual structure of each revamped page.
 * Asserts on data-bearing DOM (`.rv-*` classes + verbatim copy from the design).
 */

test.describe('home (/)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('renders 4 KPI cells', async ({ page }) => {
    const kpis = page.locator('.rv-grid-4 .rv-kpi');
    await expect(kpis).toHaveCount(4);
    await expect(kpis.nth(0)).toContainText('NAV');
    await expect(kpis.nth(1)).toContainText('Day P&L');
    await expect(kpis.nth(2)).toContainText('VaR');
    await expect(kpis.nth(3)).toContainText('Daily trades');
  });

  test('opportunity table has 8 rows', async ({ page }) => {
    const rows = page.locator('.rv-card', { hasText: 'Top opportunities' }).locator('tbody tr');
    await expect(rows).toHaveCount(8);
  });

  test('every opportunity row has a chain → link', async ({ page }) => {
    const links = page.locator('.rv-card', { hasText: 'Top opportunities' }).locator('a[href*="/options-chain?ticker="]');
    await expect(links).toHaveCount(8);
  });

  test('aggregate Greeks card shows Δ Γ Θ V', async ({ page }) => {
    const greeks = page.locator('.rv-card', { hasText: 'Portfolio Greeks' }).locator('.rv-greek');
    await expect(greeks).toHaveCount(4);
  });

  test('recent signals log has at least 4 rows', async ({ page }) => {
    const rows = page.locator('.rv-card', { hasText: 'Recent signals' }).locator('.rv-log .row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
  });
});

test.describe('scanner (/scanner)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/scanner'); });

  test('table has 8 rows of mock opportunities', async ({ page }) => {
    const rows = page.locator('.rv-card tbody tr');
    await expect(rows).toHaveCount(8);
  });

  test('first row has selection class', async ({ page }) => {
    await expect(page.locator('.rv-card tbody tr.sel').first()).toBeVisible();
  });

  test('rows contain inline sparkline SVG', async ({ page }) => {
    const sparks = page.locator('.rv-card tbody tr svg.rv-spark');
    expect(await sparks.count()).toBeGreaterThanOrEqual(8);
  });

  test('rows contain EV bar', async ({ page }) => {
    const evBars = page.locator('.rv-card tbody tr .rv-ev-bar');
    expect(await evBars.count()).toBeGreaterThanOrEqual(8);
  });

  test('hotkey footer is visible', async ({ page }) => {
    await expect(page.getByText(/open chain/i)).toBeVisible();
    await expect(page.getByText(/build trade/i)).toBeVisible();
  });
});

test.describe('option chain (/options-chain)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/options-chain'); });

  test('expiration strip has 6 cells with one selected', async ({ page }) => {
    const exps = page.locator('.rv-expstrip .rv-exp');
    await expect(exps).toHaveCount(6);
    await expect(page.locator('.rv-expstrip .rv-exp.on')).toHaveCount(1);
  });

  test('chain table has 11 strike rows', async ({ page }) => {
    const rows = page.locator('.rv-chain tbody tr');
    await expect(rows).toHaveCount(11);
  });

  test('one row is marked ATM', async ({ page }) => {
    await expect(page.locator('.rv-chain tbody tr.atm')).toHaveCount(1);
  });

  test('order ticket renders SELL primary button', async ({ page }) => {
    await expect(page.locator('.rv-ticket')).toBeVisible();
    await expect(page.locator('.rv-ticket')).toContainText(/SELL.*0\.82/);
  });

  test('ticket shows POP and EV computed metrics', async ({ page }) => {
    await expect(page.locator('.rv-ticket')).toContainText('POP');
    await expect(page.locator('.rv-ticket')).toContainText('EV / contract');
  });
});

test.describe('pricing (/pricing)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/pricing'); });

  test('first-order Greeks section has 5 cells', async ({ page }) => {
    const firstOrder = page.locator('.rv-greek-grid').first().locator('.rv-greek-big');
    await expect(firstOrder).toHaveCount(5);
  });

  test('second-order Greeks section has 3 cells with ord2 styling', async ({ page }) => {
    const secondOrder = page.locator('.rv-greek-big.ord2');
    await expect(secondOrder).toHaveCount(3);
  });

  test('inputs card shows σ and T sliders', async ({ page }) => {
    const sliders = page.locator('.rv-slider');
    expect(await sliders.count()).toBeGreaterThanOrEqual(2);
  });

  test('vol surface has a 7-column grid', async ({ page }) => {
    const cells = page.locator('.rv-surface .c');
    expect(await cells.count()).toBe(63); // 7 cols × 9 rows
  });

  test('mode toggle buttons render', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Price from IV/i }).or(page.getByText(/Price from IV/i)).first()).toBeVisible();
  });
});

test.describe('portfolio (/portfolio)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/portfolio'); });

  test('NAV card shows $142,080', async ({ page }) => {
    await expect(page.locator('.rv-card', { hasText: 'NAV' }).first()).toContainText('$142,080');
  });

  test('equity curve renders an SVG', async ({ page }) => {
    const navCard = page.locator('.rv-card', { hasText: 'NAV' }).first();
    await expect(navCard.locator('svg')).toBeVisible();
  });

  test('aggregate Greeks card has 4 cells', async ({ page }) => {
    const card = page.locator('.rv-card', { hasText: 'Aggregate Greeks' });
    await expect(card.locator('.rv-greek')).toHaveCount(4);
  });

  test('hedge suggestion card shows Δ drift copy', async ({ page }) => {
    await expect(page.getByText(/Δ drift/i)).toBeVisible();
  });

  test('positions table has 4 rows', async ({ page }) => {
    const positionsCard = page.locator('.rv-card', { hasText: 'Open positions' });
    const rows = positionsCard.locator('tbody tr');
    await expect(rows).toHaveCount(4);
  });

  test('rehedge button is visible in header', async ({ page }) => {
    await expect(page.getByText(/Rehedge to Δ 0/i)).toBeVisible();
  });
});

test.describe('auto engine (/auto-engine)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/auto-engine'); });

  test('RUNNING chip is visible', async ({ page }) => {
    await expect(page.getByText('RUNNING').first()).toBeVisible();
  });

  test('HALT ALL button is prominent', async ({ page }) => {
    await expect(page.getByText(/HALT ALL/i)).toBeVisible();
  });

  test('guardrails card shows 4 limit bars', async ({ page }) => {
    const limits = page.locator('.rv-limit');
    expect(await limits.count()).toBeGreaterThanOrEqual(4);
  });

  test('event stream shows at least 8 rows', async ({ page }) => {
    const rows = page.locator('.rv-card', { hasText: 'Event stream' }).locator('.rv-log .row');
    expect(await rows.count()).toBeGreaterThanOrEqual(8);
  });

  test('event stream filter chips render', async ({ page }) => {
    const card = page.locator('.rv-card', { hasText: 'Event stream' });
    await expect(card.locator('.tools span', { hasText: 'all' })).toBeVisible();
    await expect(card.locator('.tools span', { hasText: 'exec' })).toBeVisible();
  });

  test('first event row is colored EXEC', async ({ page }) => {
    const firstRow = page.locator('.rv-log .row').first();
    await expect(firstRow.locator('.ev')).toContainText('EXEC');
  });
});
