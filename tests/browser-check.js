#!/usr/bin/env node
// browser-check.js - optional end-to-end check in headless Chromium.
// Needs Playwright (any 1.x release; 1.0 shipped in May 2020), which is NOT a
// dependency of this project:   npm install --no-save playwright
//
// Loads the dashboard from disk (file://) and over HTTP, fails on any console
// error, exercises every filter and view, and saves screenshots to
// tests/screenshots/.
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) {
  console.log('browser-check: playwright is not installed; skipping (npm install --no-save playwright)');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

function startServer() {
  return new Promise((resolve) => {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const check = async (page, label) => {
    await page.waitForFunction(() => window.__dashboardReady === true, null, { timeout: 15000 });
    const n = await page.$$eval('#map path.area', (els) => els.length);
    const kpis = await page.$$eval('#kpis .kpi', (els) => els.length);
    if (n < 1) errors.push(label + ': map has no areas');
    if (kpis < 8) errors.push(label + ': expected 8 KPI tiles, found ' + kpis);
    return { areas: n, kpis };
  };
  const watch = (page, label) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(label + ' console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push(label + ' page error: ' + e.message));
  };

  // 1. straight from disk
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    watch(page, 'file://');
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    const r = await check(page, 'file://');
    console.log('file://   areas=' + r.areas + ' kpis=' + r.kpis);
    await page.screenshot({ path: path.join(OUT, 'overview.png'), fullPage: true });
    await page.close();
  }

  // 2. over HTTP, exercising the controls
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    watch(page, 'http');
    await page.goto(base + 'index.html');
    await check(page, 'http');
    const metrics = await page.$$eval('#map-metric option', (os) => os.map((o) => o.value));
    for (const m of metrics) {
      await page.selectOption('#map-metric', m);
      const filled = await page.$$eval('#map path.area', (els) => els.filter((e) => e.style.fill && e.style.fill !== 'var(--nodata)').length);
      if (!filled) errors.push('map metric ' + m + ': no area filled');
    }
    await page.selectOption('#map-metric', 'access');
    await page.$eval('#catchment', (el) => { el.value = '30'; el.dispatchEvent(new Event('input')); });
    await page.selectOption('#f-clinic', '1');
    await page.selectOption('#f-from', '3');
    await page.selectOption('#f-to', '8');
    for (const v of ['clinics', 'quintiles', 'none']) await page.click('#wait-compare button[data-v="' + v + '"]');
    const trends = await page.$$eval('#trend-indicator option', (os) => os.map((o) => o.value));
    for (const v of trends) {
      await page.selectOption('#trend-indicator', v);
      const paths = await page.$$eval('#trend-chart path.series', (els) => els.length);
      if (paths < 1) errors.push('trend ' + v + ': no lines');
    }
    await page.click('#map path.area >> nth=3');
    const prof = await page.textContent('#profile h4');
    if (!prof) errors.push('selecting an area did not fill the profile');
    await page.hover('#map path.area >> nth=5');
    const tip = await page.$eval('#tooltip', (el) => el.classList.contains('on'));
    if (!tip) errors.push('map hover did not show a tooltip');
    await page.click('#f-lang button[data-lang="fr"]');
    const title = await page.textContent('h1 [data-i18n="title"]');
    if (!/accessibilit/i.test(title) || !/première/i.test(title)) errors.push('French title not applied: ' + title);
    await page.click('#area-details summary');
    await page.click('#area-table th button[data-k="wait"]');
    console.log('http      ' + metrics.length + ' map metrics, ' + trends.length + ' trend indicators, area profile "' + prof + '"');
    await page.screenshot({ path: path.join(OUT, 'clinic-b-french.png'), fullPage: true });
    // hash state survives a reload
    const url = page.url();
    await page.goto('about:blank');
    await page.goto(url);
    await check(page, 'reload');
    const clinic = await page.$eval('#f-clinic', (el) => el.value);
    if (clinic !== '1') errors.push('URL state not restored (clinic=' + clinic + ')');
    await page.close();
  }

  // 3. dark mode and phone width
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    watch(page, 'mobile');
    await page.goto(base + 'index.html');
    await check(page, 'mobile');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) errors.push('mobile: page scrolls horizontally by ' + overflow + 'px');
    await page.screenshot({ path: path.join(OUT, 'mobile-dark.png'), fullPage: true });
    await page.close();
  }

  srv.close();
  await browser.close();
  if (errors.length) {
    console.error('browser-check FAILED:\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('browser-check passed; screenshots in tests/screenshots/');
})().catch((e) => { console.error(e); process.exit(1); });
