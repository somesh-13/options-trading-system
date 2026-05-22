import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test('TickerPositionsReport + TickerChatPanel render and respond on /risk-mgmt', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });

  await page.goto(`${BASE_URL}/risk-mgmt`, { waitUntil: 'networkidle', timeout: 60_000 });

  // Switch ticker to TTD via the existing TCA input.
  const tickerInput = page.getByLabel('TCA ticker');
  await expect(tickerInput).toBeVisible();
  await tickerInput.fill('TTD');
  await page.getByRole('button', { name: 'Update TCA ticker' }).click();

  // The new report panel should mount and load TTD positions.
  await expect(page.getByRole('heading', { name: /Ticker Positions Report — TTD/i })).toBeVisible({ timeout: 20_000 });

  // Wait for the report to populate — equity row mentions "sh".
  await expect(page.getByText(/sh\s*·\s*avg\s*\$/i).first()).toBeVisible({ timeout: 30_000 });

  // Aggregate Greeks chip — Δ should show.
  await expect(page.getByText(/^Aggregate$/i).first()).toBeVisible();

  // Options table — at least one row mentioning a 2028 expiry (TTD LEAP).
  await expect(page.getByText('2028-01-21').first()).toBeVisible();

  // Chat panel mounted.
  await expect(page.getByRole('heading', { name: /Ask Gemini about TTD/i })).toBeVisible();

  // Send a chat message.
  const chatInput = page.getByLabel('Message about TTD');
  await chatInput.fill('What is my net delta? One short sentence.');
  await page.getByRole('button', { name: 'send' }).click();

  // Pending indicator should appear, then a response bubble should arrive.
  await expect(page.getByText('thinking…')).toBeVisible({ timeout: 5_000 });
  // Wait for assistant reply to appear (Gemini round-trip can be slow).
  await expect(page.getByText(/delta/i).last()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('thinking…')).not.toBeVisible({ timeout: 60_000 });

  // Switch ticker to CIFR — chat history should clear and report should refetch.
  await tickerInput.fill('CIFR');
  await page.getByRole('button', { name: 'Update TCA ticker' }).click();
  await expect(page.getByRole('heading', { name: /Ticker Positions Report — CIFR/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Ask Gemini about CIFR/i })).toBeVisible();
  // Old TTD reply must not be present anymore.
  await expect(page.getByText(/Ask Gemini about TTD/i)).toHaveCount(0);

  // Capture screenshot for visual verification.
  await page.screenshot({ path: 'test-results/risk-page-ticker-feature.png', fullPage: true });

  // No JS-level errors on the page during the flow.
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
