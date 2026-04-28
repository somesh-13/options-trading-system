import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * button-sweep — disposable audit spec.
 *
 * For every route, enumerate every interactive element on the page and attempt
 * a click. Record outcome + any pageerror/console error to
 * test-results/button-sweep-<project>.json.
 *
 * Strategy:
 *  - Snapshot labels once (index + text). For each index, re-goto route and
 *    re-query by the same selector to get a fresh locator at the same index.
 *    This is safe against both DOM mutation and actual navigation.
 *  - Cap at 40 elements per route (dashboard mock pages don't have more,
 *    and this keeps runtime bounded).
 *  - Per-test timeout is raised to 180s; each individual click is bounded to
 *    4s so a single hang doesn't eat the whole budget.
 */

type Outcome = 'ok' | 'disabled' | 'hidden' | 'error' | 'pageerror' | 'navigated';

type Result = {
  route: string;
  index: number;
  tag: string;
  label: string;
  href?: string;
  outcome: Outcome;
  error?: string;
  consoleErrors: number;
  urlAfter?: string;
};

const ROUTES = [
  '/', '/scanner', '/options-chain', '/pricing', '/portfolio', '/auto-engine',
  '/vol-surface', '/sentiment', '/backtest', '/journal', '/execution',
  '/positions', '/agent', '/risk', '/risk-mgmt', '/strategy', '/replay',
];

const SELECTOR = [
  'button',
  '[role="button"]',
  'a[href]',
  '.rv-rail .item',
  '.rv-exp',
  '.rv-chip',
  '.rv-filter',
].join(', ');

const MAX_PER_ROUTE = 40;

function shouldSkipHref(href: string | null | undefined): boolean {
  if (!href) return false;
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return true;
  if (href.startsWith('http') && !href.includes('localhost') && !href.startsWith('http://127.')) return true;
  return false;
}

async function describe(el: import('@playwright/test').Locator) {
  return await el.evaluate((node) => {
    const e = node as HTMLElement;
    const tag = e.tagName.toLowerCase();
    const text = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const aria = e.getAttribute('aria-label') || '';
    const title = e.getAttribute('title') || '';
    const testid = e.getAttribute('data-testid') || '';
    const href = (e as HTMLAnchorElement).href || '';
    const label = text || aria || title || testid || tag;
    return { tag, label, href: href || undefined };
  });
}

function appendResults(projectName: string, rows: Result[]) {
  // Write outside test-results/ because Playwright wipes that dir at the start of each run.
  fs.mkdirSync('sweep-results', { recursive: true });
  const file = path.join('sweep-results', `button-sweep-${projectName}.json`);
  const prior: Result[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  fs.writeFileSync(file, JSON.stringify([...prior, ...rows], null, 2));
}

test.describe.configure({ mode: 'parallel', timeout: 240_000 });

for (const route of ROUTES) {
  test(`sweep ${route}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const projectName = testInfo.project.name;
    const rows: Result[] = [];

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.rv-topbar')).toBeVisible({ timeout: 15_000 });

    // Snapshot label set once to decide how many to click.
    const initialLocs = page.locator(SELECTOR);
    const total = Math.min(await initialLocs.count(), MAX_PER_ROUTE);
    testInfo.annotations.push({ type: 'button-count', description: `${route}: ${total}` });

    for (let i = 0; i < total; i++) {
      const urlBefore = page.url();

      // If the previous click navigated away, come back. Cheaper than goto-per-iteration
      // because most clicks don't navigate (buttons are local toggles).
      if (!urlBefore.endsWith(route) && !(route === '/' && urlBefore.replace(/^https?:\/\/[^/]+/, '') === '/')) {
        await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      const fresh = page.locator(SELECTOR).nth(i);
      let meta: { tag: string; label: string; href?: string };
      try {
        meta = await describe(fresh);
      } catch {
        rows.push({ route, index: i, tag: '?', label: '(stale)', outcome: 'hidden', consoleErrors: 0 });
        continue;
      }

      if (meta.tag === 'a' && shouldSkipHref(meta.href)) {
        rows.push({ route, index: i, tag: meta.tag, label: meta.label, href: meta.href, outcome: 'ok', consoleErrors: 0 });
        continue;
      }

      const before = { pe: pageErrors.length, ce: consoleErrors.length };
      let outcome: Outcome = 'ok';
      let error: string | undefined;

      try {
        const visible = await fresh.isVisible({ timeout: 500 }).catch(() => false);
        const enabled = await fresh.isEnabled({ timeout: 500 }).catch(() => true);
        if (!visible) { outcome = 'hidden'; }
        else if (!enabled) { outcome = 'disabled'; }
        else {
          await fresh.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
          await fresh.click({ timeout: 4000 });
          await page.waitForTimeout(120);
        }
      } catch (e) {
        outcome = 'error';
        error = (e as Error).message.split('\n')[0].slice(0, 200);
      }

      if (pageErrors.length > before.pe) {
        outcome = 'pageerror';
        error = pageErrors.slice(before.pe).join(' | ').slice(0, 200);
      }

      const urlAfter = page.url();
      const urlPath = urlAfter.replace(/^https?:\/\/[^/]+/, '');
      const navigated = urlPath !== route && !(route === '/' && urlPath === '/');
      if (outcome === 'ok' && navigated) outcome = 'navigated';

      rows.push({
        route,
        index: i,
        tag: meta.tag,
        label: meta.label,
        href: meta.href,
        outcome,
        error,
        consoleErrors: consoleErrors.length - before.ce,
        urlAfter: navigated ? urlPath : undefined,
      });
    }

    appendResults(projectName, rows);

    const errs = rows.filter((r) => r.outcome === 'pageerror' || r.outcome === 'error');
    testInfo.annotations.push({
      type: 'button-errors',
      description: `${errs.length}/${total} failed on ${route}`,
    });
  });
}
