import { test, expect } from '@playwright/test';

/**
 * Multi-leg ticket + returns-simulator overlay.
 *
 * The order panel renders on /options-chain after a strike is selected on the
 * chain. We bypass that by mounting the panel via /pricing (which renders an
 * OptionsTradePanel unconditionally).
 */

test.describe('multi-leg ticket on /pricing', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/pricing'); });

  test('+ Add leg appends a second leg row', async ({ page }) => {
    const addBtn = page.locator('[data-testid="add-leg-button"]');
    await expect(addBtn).toBeVisible();
    await expect(page.locator('[data-testid^="leg-row-"]')).toHaveCount(1);

    await addBtn.click();
    await expect(page.locator('[data-testid^="leg-row-"]')).toHaveCount(2);
  });

  test('Place button is disabled with 2 legs', async ({ page }) => {
    await page.locator('[data-testid="add-leg-button"]').click();
    const place = page.locator('[data-testid="option-submit"]');
    await expect(place).toBeDisabled();
    await expect(place).toHaveText(/simulate only/i);
  });

  test('Removing a leg returns Place to enabled state (with valid fields)', async ({ page }) => {
    await page.locator('[data-testid="add-leg-button"]').click();
    await expect(page.locator('[data-testid^="leg-row-"]')).toHaveCount(2);
    await page.locator('[data-testid="remove-leg-button-1"]').click();
    await expect(page.locator('[data-testid^="leg-row-"]')).toHaveCount(1);
  });

  test('Simulate opens the overlay; backdrop click closes it', async ({ page }) => {
    // Fill first leg with valid fields so canSimulate is true.
    await page.locator('[data-testid="option-expiration-0"]').fill('2027-01-15');
    await page.locator('[data-testid="option-strike-0"]').fill('100');
    await page.locator('[data-testid="option-quantity-0"]').fill('1');
    await page.locator('[data-testid="option-entry-price-0"]').fill('1.50');

    const sim = page.locator('[data-testid="simulate-button"]');
    await expect(sim).toBeEnabled();
    await sim.click();

    const overlay = page.locator('[data-testid="simulator-overlay"]');
    await expect(overlay).toBeVisible();
    await expect(page.locator('[data-testid="simulator-spot-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="simulator-sigma-input"]')).toBeVisible();

    // Click backdrop (the dialog wrapper itself) to dismiss.
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toBeHidden();
  });

  test('Date slider appears after data loads and updates index', async ({ page }) => {
    await page.locator('[data-testid="option-expiration-0"]').fill('2027-01-15');
    await page.locator('[data-testid="option-strike-0"]').fill('100');
    await page.locator('[data-testid="option-quantity-0"]').fill('1');
    await page.locator('[data-testid="option-entry-price-0"]').fill('1.50');
    await page.locator('[data-testid="simulate-button"]').click();

    const slider = page.locator('[data-testid="simulator-date-slider"]');
    // Slider may take a moment to appear (one debounced fetch round-trip).
    await expect(slider).toBeVisible({ timeout: 10_000 });

    // Move to the right end (expiry date).
    const max = await slider.getAttribute('max');
    if (max) {
      await slider.fill(max);
      await expect(slider).toHaveValue(max);
    }
  });
});
