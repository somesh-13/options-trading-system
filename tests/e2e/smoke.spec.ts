import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke — every route returns 200, the AppShell renders, no uncaught JS errors.
 *
 * Console errors are *recorded* but don't fail the test (legacy pages still call
 * backends that may 404 in some environments). The full list lands in the
 * markdown report so QA can decide what to escalate.
 */

type RouteSpec = {
  path: string;
  title: RegExp; // matched against the .rv-h1 text content
  revamped: boolean;
};

const ROUTES: RouteSpec[] = [
  // Phase 2-7 — fully revamped, expected .rv-h1 title
  { path: '/',              title: /Today/i,         revamped: true },
  { path: '/scanner',       title: /Scanner/i,       revamped: true },
  { path: '/options-chain', title: /CIFR/i,          revamped: true },
  { path: '/pricing',       title: /CIFR.*240517/i,  revamped: true },
  { path: '/portfolio',     title: /Portfolio/i,     revamped: true },
  { path: '/robinhood',     title: /Robinhood/i,     revamped: true },
  { path: '/auto-engine',   title: /Auto engine/i,   revamped: true },
  // Phase 8 — legacy pages with cleaned headers (back-link removed, h1 → rv-h1)
  { path: '/vol-surface',   title: /./,              revamped: false },
  { path: '/sentiment',     title: /./,              revamped: false },
  { path: '/backtest',      title: /./,              revamped: false },
  { path: '/journal',       title: /./,              revamped: false },
  { path: '/execution',     title: /./,              revamped: false },
  { path: '/positions',     title: /./,              revamped: false },
  { path: '/agent',         title: /./,              revamped: false },
  { path: '/risk',          title: /./,              revamped: false },
  { path: '/risk-mgmt',     title: /./,              revamped: false },
  { path: '/strategy',      title: /./,              revamped: false },
  { path: '/replay',        title: /./,              revamped: false },
];

async function captureErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200)); });
  return { pageErrors, consoleErrors };
}

for (const route of ROUTES) {
  test(`smoke ${route.path} — shell renders, no uncaught errors`, async ({ page }) => {
    const { pageErrors, consoleErrors } = await captureErrors(page);

    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `HTTP status for ${route.path}`).toBeLessThan(400);

    // Shell must render on every page.
    await expect(page.locator('.rv-topbar')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.rv-rail')).toBeVisible();

    // Page title (rv-h1) — only assert content for revamped pages.
    if (route.revamped) {
      const heading = page.locator('.rv-h1').first();
      await expect(heading).toBeVisible({ timeout: 10_000 });
      await expect(heading).toContainText(route.title);
    }

    // Hard fail on uncaught JS exceptions; console errors recorded for the report.
    expect(pageErrors, `pageerror on ${route.path}: ${pageErrors.join(' | ')}`).toHaveLength(0);

    // Annotate test with console-error count (visible in JSON reporter output).
    if (consoleErrors.length) {
      test.info().annotations.push({ type: 'console-errors', description: `${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(' | ')}` });
    }
  });
}
