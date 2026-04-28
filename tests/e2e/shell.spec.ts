import { test, expect } from '@playwright/test';

/**
 * Shell — top bar, left rail, command palette (⌘K).
 * These structural pieces are present on every page, so we test them once on `/`.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.rv-topbar')).toBeVisible();
});

test.describe('top bar', () => {
  test('brand reads "vegaEdge"', async ({ page }) => {
    const brand = page.locator('.rv-brand .name');
    await expect(brand).toBeVisible();
    await expect(brand).toContainText('vega');
    await expect(brand).toContainText('Edge');
  });

  test('breadcrumbs reflect current route', async ({ page }) => {
    await expect(page.locator('.rv-crumbs')).toContainText('Home');
    await page.goto('/scanner');
    await expect(page.locator('.rv-crumbs')).toContainText('Scanner');
  });

  test('palette trigger button shows ⌘K hint', async ({ page }) => {
    const trigger = page.locator('.rv-search');
    await expect(trigger).toBeVisible();
    await expect(trigger.locator('.kbd')).toContainText('⌘K');
  });

  test('all 4 status pills render', async ({ page }) => {
    const pills = page.locator('.rv-pills .rv-pill');
    await expect(pills).toHaveCount(4);
    await expect(page.locator('.rv-pill.regime')).toContainText(/HMM/);
    await expect(page.locator('.rv-pill.var')).toContainText(/VaR/);
    await expect(page.locator('.rv-pill.paper')).toContainText('PAPER');
  });
});

test.describe('left rail', () => {
  test('renders 11 nav items + 2 separators', async ({ page }) => {
    const items = page.locator('.rv-rail .item');
    await expect(items).toHaveCount(11);
    await expect(page.locator('.rv-rail .sep')).toHaveCount(2);
  });

  test('every rail item has visible icon + label', async ({ page }) => {
    const labels = ['Home', 'Scanner', 'Chain', 'Pricing', 'Portfolio', 'Positions', 'Risk', 'Auto', 'Backtest', 'NLP', 'Agent'];
    for (const lbl of labels) {
      await expect(page.locator(`.rv-rail .item .rlabel`, { hasText: lbl })).toBeVisible();
    }
  });

  test('home item is active on /', async ({ page }) => {
    await expect(page.locator('.rv-rail .item.active .rlabel')).toContainText('Home');
  });

  test('scanner item is active after navigation to /scanner', async ({ page }) => {
    await page.goto('/scanner');
    await expect(page.locator('.rv-rail .item.active .rlabel')).toContainText('Scanner');
  });

  test('clicking a rail item navigates', async ({ page }) => {
    await page.locator('.rv-rail .item', { hasText: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing/);
    await expect(page.locator('.rv-rail .item.active .rlabel')).toContainText('Pricing');
  });
});

test.describe('command palette (⌘K)', () => {
  test('opens with Ctrl+K, closes with Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.rv-cmd')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.rv-cmd')).toBeHidden();
  });

  test('opens by clicking the search trigger', async ({ page }) => {
    await page.locator('.rv-search').click();
    await expect(page.locator('.rv-cmd')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('typing filters items', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.rv-cmd-input').fill('cifr');
    const items = page.locator('.rv-cmd-item');
    await expect(items.first()).toBeVisible();
    // At least one ticker result for CIFR
    const tickerItems = page.locator('.rv-cmd-item .kind', { hasText: 'ticker' });
    await expect(tickerItems.first()).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Enter on a ticker navigates to /options-chain', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.rv-cmd-input').fill('cifr');
    // Wait for ticker item to be selectable
    await expect(page.locator('.rv-cmd-item').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/options-chain/);
  });

  test('Enter on a nav item navigates to that page', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.rv-cmd-input').fill('portfolio');
    await expect(page.locator('.rv-cmd-item').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/portfolio/);
  });
});
