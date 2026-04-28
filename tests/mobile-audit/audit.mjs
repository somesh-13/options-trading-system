// Mobile UI audit. Walks every top-level route across several mobile viewports,
// captures screenshots, console errors, and DOM-overflow / tap-target issues.
//
// Usage: node tests/mobile-audit/audit.mjs

import { chromium, devices } from '/tmp/pw-audit/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = join(__dirname, 'screenshots');
const REPORT_PATH = join(__dirname, 'report.json');

mkdirSync(SHOT_DIR, { recursive: true });

const ROUTES = [
  '/', '/strategy', '/pricing', '/options-chain', '/portfolio', '/positions',
  '/journal', '/replay', '/agent', '/auto-engine', '/backtest', '/execution',
  '/risk', '/risk-mgmt', '/scanner', '/sentiment', '/vol-surface',
];

// iPhone 16 Pro CSS viewport ≈ 402x874, DPR 3.
const iphone16Pro = {
  name: 'iPhone 16 Pro',
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

const VIEWPORTS = [
  iphone16Pro,
  { name: 'iPhone SE', ...devices['iPhone SE'] },
  { name: 'Pixel 7', ...devices['Pixel 7'] },
  { name: 'Galaxy S9+', ...devices['Galaxy S9+'] },
];

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();

async function auditPage(context, route, viewport) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  let nav = { ok: true, status: 0 };
  try {
    const res = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30_000 });
    nav.status = res?.status() ?? 0;
  } catch (e) {
    nav = { ok: false, status: 0, error: e.message };
  }

  // Give client components a beat to render.
  await page.waitForTimeout(800);

  // Collect layout problems: horizontal overflow + tiny tap targets + offscreen elements.
  const findings = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docW = document.documentElement.scrollWidth;
    const horizontalOverflow = docW > vw + 1;

    const overflowingEls = [];
    const offscreenInteractive = [];
    const smallTapTargets = [];
    const tinyText = [];

    const all = Array.from(document.body.querySelectorAll('*'));
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      // Element extends beyond viewport horizontally.
      if (r.right > vw + 1 && r.width > 24) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className && typeof el.className === 'string'
          ? '.' + el.className.split(/\s+/).slice(0, 3).join('.')
          : '';
        overflowingEls.push({
          selector: `${tag}${id}${cls}`.slice(0, 160),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.innerText || '').trim().slice(0, 60),
        });
      }

      // Interactive controls that are clipped or offscreen.
      const interactive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
      if (interactive) {
        if (r.right > vw + 1 || r.left < -1) {
          offscreenInteractive.push({
            selector: el.tagName.toLowerCase(),
            text: (el.innerText || el.value || '').trim().slice(0, 40),
            left: Math.round(r.left),
            right: Math.round(r.right),
          });
        }
        if ((r.width < 36 || r.height < 36) && r.width > 0 && r.height > 0) {
          smallTapTargets.push({
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.value || '').trim().slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }

      // Tiny text — sub-12px is hard to read on phones.
      const cs = window.getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      if (fs && fs < 11 && el.children.length === 0 && (el.innerText || '').trim().length > 0) {
        tinyText.push({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').trim().slice(0, 60),
          fontSize: fs,
        });
      }
    }

    // Dedup & cap.
    const uniq = (arr, key) => {
      const seen = new Set();
      return arr.filter((x) => {
        const k = key(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };

    return {
      viewportWidth: vw,
      documentWidth: docW,
      horizontalOverflow,
      overflowAmount: docW - vw,
      overflowingEls: uniq(overflowingEls, (x) => x.selector).slice(0, 20),
      offscreenInteractive: uniq(offscreenInteractive, (x) => x.selector + x.text).slice(0, 15),
      smallTapTargets: uniq(smallTapTargets, (x) => x.tag + x.text).slice(0, 15),
      tinyText: uniq(tinyText, (x) => x.text).slice(0, 10),
    };
  });

  const shotName = `${slug(viewport.name)}__${slug(route) || 'home'}.png`;
  const shotPath = join(SHOT_DIR, shotName);
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
  } catch (e) {
    findings.screenshotError = e.message;
  }

  await page.close();
  return { route, viewport: viewport.name, nav, consoleErrors, pageErrors, findings, screenshot: shotName };
}

async function main() {
  const browser = await chromium.launch();
  const report = { base: BASE, generatedAt: new Date().toISOString(), results: [] };

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext(vp);
    for (const route of ROUTES) {
      process.stdout.write(`[${vp.name}] ${route} ... `);
      const r = await auditPage(ctx, route, vp);
      report.results.push(r);
      const flags = [];
      if (!r.nav.ok || r.nav.status >= 400) flags.push(`nav=${r.nav.status}`);
      if (r.findings.horizontalOverflow) flags.push(`overflow=+${r.findings.overflowAmount}px`);
      if (r.findings.offscreenInteractive.length) flags.push(`offscreen=${r.findings.offscreenInteractive.length}`);
      if (r.consoleErrors.length) flags.push(`console=${r.consoleErrors.length}`);
      if (r.pageErrors.length) flags.push(`pageerr=${r.pageErrors.length}`);
      console.log(flags.length ? flags.join(' ') : 'ok');
    }
    await ctx.close();
  }

  await browser.close();
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
