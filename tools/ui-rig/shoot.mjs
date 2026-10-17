#!/usr/bin/env node
/**
 * UI rig: screenshots of every screen of apps/web, rendered against the mock API (mock-api.mjs).
 *
 *   node tools/ui-rig/shoot.mjs --base http://localhost:3000 --out <dir> [--only a,b] [--theme light|dark|both]
 *                               [--viewports desktop,mobile] [--api http://localhost:4000] [--tall] [--show-dev-overlay]
 *
 * For each route: sets the `rig_persona` cookie (and the sign-in marker cookie the middleware looks for),
 * sets localStorage `theme` before the page loads, waits for network idle + 800 ms with animations off,
 * then saves a full-page PNG per viewport and theme: <out>/<name>--<desktop|mobile>--<theme>.png.
 * Console errors, page errors, failed /api calls and any loader or error box still on screen are
 * logged per route and written to <out>/report.json. Exit code 1 if any route had a problem.
 */
import fs from 'node:fs';
import path from 'node:path';

/* ---------------------------------------------------------------- arguments */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
if (flag('help') || flag('h')) {
  console.log('node shoot.mjs --base http://localhost:3000 --out <dir> [--only name1,name2] [--theme light|dark|both] [--viewports desktop,mobile] [--api http://localhost:4000] [--tall] [--settle 800] [--show-dev-overlay] [--list]');
  process.exit(0);
}
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const API = arg('api', 'http://localhost:4000').replace(/\/$/, '');
const OUT = path.resolve(arg('out', 'ui-shots'));
const ONLY = arg('only', '')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const THEME = arg('theme', 'light');
const THEMES = THEME === 'both' ? ['light', 'dark'] : [THEME];
const VIEWPORTS_WANTED = arg('viewports', 'desktop,mobile').split(',').map((s) => s.trim());
const SHOW_OVERLAY = flag('show-dev-overlay');
const SETTLE_MS = Number(arg('settle', '800'));
// --tall: grow the viewport to the page's height instead of a full-page capture, so fixed bars (mobile tab bar,
// Ask button) sit at the bottom of the image rather than where the first screen ended. 100vh grows with it.
const TALL = flag('tall');

if (!['light', 'dark', 'both'].includes(THEME)) {
  console.error(`--theme must be light, dark or both (got ${THEME})`);
  process.exit(2);
}

/* ---------------------------------------------------------------- routes (name, persona, path) */
// anon = not signed in: no sign-in marker cookie, and the mock answers /auth/me with 401.
const ROUTES = [
  ['owner-home', 'owner', '/'],
  ['owner-automations', 'owner', '/automations'],
  ['owner-energy', 'owner', '/energy'],
  ['owner-people', 'owner', '/people'],
  ['owner-rooms', 'owner', '/rooms'],
  ['owner-activity', 'owner', '/activity'],
  ['owner-device', 'owner', '/devices/d-kitchen-temp'],
  ['owner-diagnostics', 'owner', '/diagnostics'],
  ['owner-notifications', 'owner', '/notifications'],
  ['owner-support', 'owner', '/support'],
  ['owner-help', 'owner', '/help'],
  ['owner-account', 'owner', '/account'],
  ['owner-summary', 'owner', '/summary'],
  ['member-home', 'member', '/'],
  ['console-overview', 'superadmin', '/console'],
  ['console-homes', 'superadmin', '/console/homes'],
  ['console-workspace', 'superadmin', '/console/homes/home-iqbal'],
  ['console-inventory', 'superadmin', '/console/inventory'],
  ['console-requests', 'superadmin', '/console/requests'],
  ['console-tickets', 'superadmin', '/console/tickets'],
  ['console-team', 'superadmin', '/console/team'],
  ['console-help', 'superadmin', '/console/help'],
  ['installer-jobs', 'installer', '/console/homes'],
  ['landing', 'anon', '/welcome'],
  ['login', 'anon', '/login'],
];
if (flag('list')) {
  for (const [name, persona, p] of ROUTES) console.log(`${name.padEnd(22)} ${persona.padEnd(11)} ${p}`);
  process.exit(0);
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
};
const viewports = VIEWPORTS_WANTED.filter((v) => VIEWPORTS[v]);

const selected = ONLY.length ? ROUTES.filter(([name]) => ONLY.includes(name)) : ROUTES;
const missing = ONLY.filter((n) => !ROUTES.some(([name]) => name === n));
if (missing.length) {
  console.error(`Unknown route name(s): ${missing.join(', ')}. Use --list to see them.`);
  process.exit(2);
}

/* ---------------------------------------------------------------- playwright */
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = await import('playwright');

/** Hide Next's dev overlay/indicator and stop every animation, caret and smooth scroll. */
const FREEZE_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
  ${SHOW_OVERLAY ? '' : 'nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }'}
`;

function cookiesFor(persona) {
  const url = new URL(BASE);
  const base = { domain: url.hostname, path: '/', sameSite: 'Lax' };
  const list = [{ name: 'rig_persona', value: persona, ...base }];
  // the middleware sends visitors without a sign-in marker to the landing page at /
  if (persona !== 'anon') list.push({ name: 'sb_session', value: 'rig', ...base });
  return list;
}

async function resetMock() {
  try {
    const r = await fetch(`${API}/__rig/reset`, { method: 'POST' });
    return r.ok;
  } catch {
    return false;
  }
}
async function mockUnknown() {
  try { return await (await fetch(`${API}/__rig/unknown`)).json(); } catch { return null; }
}

fs.mkdirSync(OUT, { recursive: true });
if (!(await resetMock())) console.warn(`! Could not reach the mock API at ${API} (start it: node tools/ui-rig/mock-api.mjs). Shooting anyway.`);

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  headless: true,
  // behind a proxy (CI sandboxes): outside resources such as Google Fonts go through it; the app itself never does
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1,::1' } } : {}),
});

const report = [];
let problems = 0;
const started = Date.now();

for (const [name, persona, route] of selected) {
  for (const vpName of viewports) {
    for (const theme of THEMES) {
      const t0 = Date.now();
      const vp = VIEWPORTS[vpName];
      const context = await browser.newContext({
        ...vp, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block', ignoreHTTPSErrors: true,
        locale: 'en-GB', timezoneId: 'Asia/Karachi',
      });
      await context.addCookies(cookiesFor(persona));
      await context.addInitScript(({ theme: t, css }) => {
        try { localStorage.setItem('theme', t); } catch { /* storage blocked */ }
        const add = () => { const s = document.createElement('style'); s.setAttribute('data-ui-rig', ''); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
      }, { theme, css: FREEZE_CSS });

      const page = await context.newPage();
      const issues = { consoleErrors: [], pageErrors: [], failedApi: [] };
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const where = m.location()?.url;
        const text = /^Failed to load resource/.test(m.text()) && where ? `${m.text()} ${where}` : m.text();
        // expected noise: fonts/images outside the app, the dev server's HMR socket, favicon
        // and the optional hands-free wake-word model (/voice/*.onnx, not in the repo: the app probes it with HEAD)
        if (/fonts\.g(oogle|static)apis|fonts\.gstatic|images\.unsplash|webpack-hmr|favicon|\/voice\/[^ ]*\.onnx/i.test(text)) return;
        issues.consoleErrors.push(text.slice(0, 400));
      });
      page.on('pageerror', (e) => issues.pageErrors.push(String(e?.stack ?? e).slice(0, 600)));
      page.on('response', (r) => {
        const u = new URL(r.url());
        if (!u.pathname.startsWith('/api/') || r.status() < 400) return;
        // anon pages are meant to get 401 from /auth/me (and /auth/refresh)
        if (persona === 'anon' && r.status() === 401) return;
        issues.failedApi.push(`${r.request().method()} ${u.pathname}${u.search} -> ${r.status()}`);
      });

      let navError = null;
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 180_000 });
      } catch (e) {
        navError = String(e?.message ?? e).split('\n')[0];
      }
      await page.waitForTimeout(SETTLE_MS);
      // still on a loader or an error box?
      const state = await page.evaluate(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const texts = (sel) => [...document.querySelectorAll(sel)].filter(visible).map((el) => (el.textContent ?? '').trim().slice(0, 160));
        return {
          url: location.pathname + location.search,
          title: document.title,
          theme: document.documentElement.dataset.theme ?? null,
          loaders: texts('.loader'),
          errors: texts('.alert, [role="alert"]'),
          nextError: !!document.querySelector('nextjs-portal')?.shadowRoot?.querySelector('[data-nextjs-dialog], [data-nextjs-error-overlay]'),
          height: document.documentElement.scrollHeight,
        };
      }).catch((e) => ({ url: null, evalError: String(e) }));

      const file = path.join(OUT, `${name}--${vpName}--${theme}.png`);
      let shotError = null;
      try {
        if (TALL) {
          const h = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.setViewportSize({ width: vp.viewport.width, height: Math.min(Math.max(h, vp.viewport.height), 16_000) });
          await page.waitForTimeout(300);
        }
        // lazy images: make every one load and decode before the capture
        await page.evaluate(async () => {
          document.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
          await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 15000); }))));
          await Promise.all([...document.images].map((img) => img.decode?.().catch(() => null)));
        }).catch(() => null);
        await page.waitForTimeout(200);
        await page.screenshot({ path: file, fullPage: !TALL, animations: 'disabled', caret: 'hide', timeout: 60_000 });
      } catch (e) {
        shotError = String(e?.message ?? e).split('\n')[0];
      }
      await context.close();

      const redirected = state.url && state.url.split('?')[0] !== route.split('?')[0];
      const entry = {
        name, persona, route, viewport: vpName, theme, file: path.relative(process.cwd(), file), ms: Date.now() - t0,
        finalUrl: state.url, redirected: !!redirected, title: state.title, appliedTheme: state.theme,
        loaders: state.loaders ?? [], errorBoxes: state.errors ?? [], nextErrorOverlay: !!state.nextError,
        ...issues, navError, shotError, evalError: state.evalError ?? null,
      };
      const bad = entry.pageErrors.length || entry.consoleErrors.length || entry.failedApi.length || entry.loaders.length || entry.errorBoxes.length
        || entry.nextErrorOverlay || entry.redirected || navError || shotError || entry.evalError || entry.appliedTheme !== theme;
      entry.ok = !bad;
      if (bad) problems++;
      report.push(entry);

      const tag = entry.ok ? 'ok ' : 'BAD';
      console.log(`${tag} ${name.padEnd(22)} ${vpName.padEnd(7)} ${theme.padEnd(5)} ${String(entry.ms).padStart(6)} ms  ${entry.file}`);
      if (!entry.ok) {
        const lines = [
          ...(redirected ? [`redirected to ${state.url}`] : []),
          ...(entry.appliedTheme !== theme ? [`theme on <html> is ${entry.appliedTheme}`] : []),
          ...entry.loaders.map((l) => `loader still showing: "${l}"`),
          ...entry.errorBoxes.map((l) => `error box: "${l}"`),
          ...(entry.nextErrorOverlay ? ['Next.js error overlay is open'] : []),
          ...entry.pageErrors.map((e) => `page error: ${e.split('\n')[0]}`),
          ...entry.consoleErrors.map((e) => `console: ${e.split('\n')[0]}`),
          ...entry.failedApi.map((e) => `api: ${e}`),
          ...[navError, shotError, entry.evalError].filter(Boolean).map((e) => `error: ${e}`),
        ];
        for (const l of lines) console.log(`      - ${l}`);
      }
    }
  }
}
await browser.close();

const unknownPaths = await mockUnknown();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, api: API, at: new Date().toISOString(), unknownApiPaths: unknownPaths, shots: report }, null, 2));
console.log(`\n${report.length - problems}/${report.length} shots clean in ${Math.round((Date.now() - started) / 1000)} s → ${OUT}`);
if (unknownPaths && Object.keys(unknownPaths).length) console.log(`Unknown API paths (served [] or {}): ${Object.keys(unknownPaths).join(', ')}`);
else if (unknownPaths) console.log('Unknown API paths: none');
process.exit(problems ? 1 : 0);
