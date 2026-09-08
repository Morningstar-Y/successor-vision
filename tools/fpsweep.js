#!/usr/bin/env node
/*
 * Layout + contrast sweep for the embedded Flow Planner.
 *
 * The planner is a separate document inside an iframe, so tools/sweep.js
 * measures the iframe element and stops at its boundary. That is how the
 * planner kept 113 hand-picked font sizes, 62 hand-picked radii, and a
 * set of real contrast failures while the app around it was being put on
 * scales and checked.
 *
 * It is a srcdoc iframe, so contentDocument is reachable from the parent
 * and everything the page sweep does can be done in here. Same rules:
 * composite alpha before judging contrast, freeze animation before
 * measuring, and wait out the theme cross-fade.
 *
 * Run: node tools/fpsweep.js
 */
const puppeteer = require('puppeteer');
const APP = require('url').pathToFileURL(require('path').join(__dirname, '..', 'index.html')).href;

(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(APP, { waitUntil: 'load' });
  await p.evaluate(() => {
    S.tourDone = 1; S.sleepAge = 30; S.sleepProfile = 'adult'; save();
    const t = document.getElementById('tour');
    if (t && t.classList.contains('on')) tourEnd();
  });
  await new Promise(r => setTimeout(r, 1500));
  await p.evaluate(() => goPage('todo'));
  await new Promise(r => setTimeout(r, 2200));

  let problems = 0;
  for (const [w, h, label] of [[1440,900,'desktop'],[820,900,'tablet'],[375,812,'phone']]) {
    await p.setViewport({ width: w, height: h });
    await new Promise(r => setTimeout(r, 500));
    const res = await p.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const fr = document.querySelector('#pg-todo iframe');
      if (!fr || !fr.contentDocument) return ['planner iframe not reachable'];
      const d = fr.contentDocument, win = fr.contentWindow;

      const st = d.createElement('style');
      st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
      d.head.appendChild(st);
      await sleep(150);

      const rgba = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const q = m[1].split(',').map(parseFloat);
        return { r:q[0], g:q[1], b:q[2], a:q.length>3?q[3]:1 }; };
      const over = (t,bt) => ({ r:t.r*t.a+bt.r*(1-t.a), g:t.g*t.a+bt.g*(1-t.a),
                                b:t.b*t.a+bt.b*(1-t.a), a:1 });
      const srgb = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
      const lum = c => 0.2126*srgb(c.r)+0.7152*srgb(c.g)+0.0722*srgb(c.b);
      const ratio = (a,q) => { const l1=lum(a), l2=lum(q);
        return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
      const bgOf = el => { const stack=[]; let n=el;
        while (n && n !== d.documentElement) {
          const cs = win.getComputedStyle(n);
          if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
          const c = rgba(cs.backgroundColor);
          if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
          n = n.parentElement; }
        const root = rgba(win.getComputedStyle(d.body).backgroundColor) || {r:255,g:255,b:255,a:1};
        let acc = stack.length && stack[stack.length-1].a === 1 ? stack.pop() : root;
        if (acc.a !== 1) acc = { ...acc, a:1 };
        for (let i=stack.length-1;i>=0;i--) acc = over(stack[i], acc);
        return acc; };

      /* An emoji renders in its own colours whatever CSS `color` says, so
         comparing that colour against the background measures nothing.
         The planner uses emoji as nav icons, which is what made this
         report .nav-icon at 3.88:1 on a sun glyph. */
      const emojiOnly = t => t.length > 0 && !/[A-Za-z0-9]/.test(t) &&
        /\p{Extended_Pictographic}/u.test(t);

      const out = [];
      for (const dark of [false, true]) {
        applyTheme(dark);
        await sleep(500);
        const vw = fr.clientWidth;
        let clipped = 0, lowC = 0, tiny = 0;
        const hs = d.documentElement.scrollWidth > vw + 2;
        d.querySelectorAll('*').forEach(n => {
          const q = n.getBoundingClientRect();
          const cs = win.getComputedStyle(n);
          if (q.width > 0 && q.right > vw + 2 && cs.position !== 'fixed') {
            let a2 = n.parentElement, reach = false;
            while (a2 && a2 !== d.body) {
              const c2 = win.getComputedStyle(a2);
              if (/auto|scroll/.test(c2.overflowX)) { reach = true; break; }
              if (c2.overflowX === 'hidden') break;
              a2 = a2.parentElement; }
            if (!reach) clipped++;
          }
          const txt = (n.textContent || '').trim();
          if (n.children.length === 0 && txt && q.width > 0 && !emojiOnly(txt)) {
            const fg = rgba(cs.color), bg = bgOf(n);
            const size = parseFloat(cs.fontSize);
            if (size < 9) tiny++;
            if (fg && bg && fg.a > 0.6) {
              const need = (size >= 18 || (size >= 14 && +cs.fontWeight >= 700)) ? 3 : 4.5;
              if (ratio(fg, bg) < need) lowC++;
            }
          }
        });
        if (hs || clipped || lowC || tiny)
          out.push(`${dark?'dark ':'light'} planner` + (hs?' HSCROLL':'') +
            (clipped?' CLIPPED='+clipped:'') + (lowC?' LOWCONTRAST='+lowC:'') +
            (tiny?' SUB-9PX-TEXT='+tiny:''));
      }
      applyTheme(false);
      st.remove();
      return out;
    });
    console.log(res.length ? `  ${label} (${w}px): ${res.length}\n      ` + res.join('\n      ')
                           : `  ok    ${label} (${w}px): clean`);
    problems += res.length;
  }
  await b.close();
  if (errs.length) console.log('\n' + errs.join('\n'));
  const n = problems + errs.length;
  console.log(n ? `\n${n} finding(s)` : '\nplanner sweep clean');
  process.exit(n ? 1 : 0);
})().catch(e => { console.error('crashed:', e.message); process.exit(1); });
