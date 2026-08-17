#!/usr/bin/env node
/*
 * Runtime smoke test: load the app, visit every page, fail on any error.
 *
 * check.js reads the file. This one runs it. That distinction matters
 * here because the failure mode this project keeps hitting is a
 * top-level throw — which parses fine, and then aborts every remaining
 * statement in its script block, silently killing features far away
 * from the edit. Static analysis cannot see that; loading the page can.
 *
 * Usage:  node tools/smoke.js            (uses ./index.html)
 *         node tools/smoke.js <url>
 *
 * Puppeteer is optional. If it is not installed this exits 0 with a
 * notice rather than failing the push — a missing dev dependency should
 * not block a deploy, but a broken page should.
 */
const path = require('path');
const fs = require('fs');

const PAGES = ['home', 'ai', 'dashboard', 'sleep', 'todo', 'stopwatch',
               'pomodoro', 'analytics', 'diary', 'profile', 'settings'];

let puppeteer;
try { puppeteer = require('puppeteer'); }
catch (e) {
  console.log('  skip  runtime smoke test (puppeteer not installed)');
  console.log('        install with: npm i -D puppeteer');
  process.exit(0);
}

const target = process.argv[2] ||
  ('file://' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/'));

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];

  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text()))
      errors.push('console: ' + m.text().slice(0, 160));
  });

  /* Seed a returning user BEFORE any app script runs. The first-run
     flows are deliberately intrusive — the tour starts on a timer and
     navigates to its own first page, and the sleep-age prompt covers
     the screen. Both would fight the walk below and produce failures
     that say nothing about the pages themselves. */
  await page.evaluateOnNewDocument(() => {
    // Only the theme. Seeding a partial sv3 is worse than not seeding:
    // the app builds its own defaults and a half-written object just
    // trips the code that expects those arrays to exist.
    try { localStorage.setItem('sv-theme', 'light'); } catch (e) {}
  });

  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(target, { waitUntil: 'load', timeout: 30000 });
  // belt and braces, in case the seed did not take on this origin
  await page.evaluate(() => {
    const ov = document.getElementById('slp-age-overlay');
    if (ov && getComputedStyle(ov).display !== 'none') {
      const i = document.querySelector('#slp-age-card input');
      if (i) { i.value = '30'; i.dispatchEvent(new Event('input', { bubbles: true })); }
      const b = [...document.querySelectorAll('#slp-age-card button')]
        .find(x => /Set My Profile/i.test(x.textContent));
      if (b) b.click();
    }
    const t = document.getElementById('tour');
    if (t && t.classList.contains('on') && typeof tourEnd === 'function') tourEnd();
    /* Set the flag the deferred tour timer checks, so it never starts.
       The tour navigates to its own first page, which would otherwise
       yank the walk below onto a different page mid-run. */
    try { if (typeof S === 'object') { S.tourDone = 1; if (typeof save === 'function') save(); } } catch (e) {}
  });
  // let the deferred first-run timers fire and settle before walking
  await new Promise(r => setTimeout(r, 1800));
  await page.evaluate(() => {
    const t = document.getElementById('tour');
    if (t && t.classList.contains('on') && typeof tourEnd === 'function') tourEnd();
    const b = document.getElementById('bday-overlay');
    if (b && b.classList.contains('on') && typeof bdayDismiss === 'function') bdayDismiss();
  });

  const bootErrors = errors.length;
  if (bootErrors) {
    console.log(`  FAIL  ${bootErrors} error(s) on load`);
    errors.forEach(e => console.log('        ' + e));
  } else console.log('  ok    app loads clean');

  /* Every page, at desktop and phone. The maintenance unit here is
     pages x viewports, so the test walks both. */
  for (const [w, h, label] of [[1280, 860, 'desktop'], [375, 812, 'phone']]) {
    await page.setViewport({ width: w, height: h });
    const before = errors.length;
    for (const id of PAGES) {
      await page.evaluate(p => { if (typeof goPage === 'function') goPage(p); }, id);
      await new Promise(r => setTimeout(r, 90));
      const ok = await page.evaluate(p => {
        const el = document.getElementById('pg-' + p);
        return !!el && el.classList.contains('on');
      }, id);
      if (!ok) errors.push(`${label}: page "${id}" did not open`);
    }
    const added = errors.length - before;
    console.log(added ? `  FAIL  ${added} problem(s) walking all ${PAGES.length} pages at ${label}`
                      : `  ok    all ${PAGES.length} pages open clean at ${label}`);
  }

  await browser.close();

  if (errors.length) {
    console.log('\n' + errors.slice(0, 12).map(e => '    ' + e).join('\n'));
    console.log(`\n${errors.length} RUNTIME FAILURE(S)`);
    process.exit(1);
  }
  console.log('\nruntime smoke test passed');
})().catch(e => { console.error('smoke test crashed:', e.message); process.exit(1); });
