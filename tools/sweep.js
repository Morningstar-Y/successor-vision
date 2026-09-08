/* Layout + contrast sweep across pages, themes and widths, in a real
   browser. Alpha backgrounds are composited before judging contrast —
   reading the topmost rgba() as opaque produced ~80 phantom failures
   in an earlier pass. */
const puppeteer = require('puppeteer');
const PAGES = ['home','ai','dashboard','sleep','todo','stopwatch',
               'pomodoro','analytics','diary','profile','settings'];

(async () => {
  const b = await puppeteer.launch({ args:['--no-sandbox'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(require('url').pathToFileURL(require('path').join(__dirname,'..','index.html')).href, { waitUntil:'load' });
  await p.evaluate(() => {
    const ov = document.getElementById('slp-age-overlay');
    if (ov && getComputedStyle(ov).display !== 'none') {
      const i = document.querySelector('#slp-age-card input');
      if (i) { i.value = '30'; i.dispatchEvent(new Event('input', { bubbles:true })); }
      const btn = [...document.querySelectorAll('#slp-age-card button')]
        .find(x => /Set My Profile/i.test(x.textContent)); if (btn) btn.click();
    }
    S.tourDone = 1;
    /* renderSleep re-opens the age prompt whenever sleepProfile is
       unset, so filling the input is not enough. */
    S.sleepAge=30; S.sleepProfile='adult';
    S.habits = ['Gym','Reading','Walk'].map(n => ({ id:newId(), name:n, emoji:'\u2705' }));
    S.checks = {};
    /* Lap rows and the current-focus-task chip only exist after the user
       presses Lap or adds a task, so an unseeded sweep never measured
       them -- and both turned out to use tinted-overlay colour pairs. */
    S.pomoTasks = [{id:newId(),text:'Write the brief'},{id:newId(),text:'Review inbox'}];
    S.sleepLog = Array.from({length:8},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);
      return {date:d.toISOString().slice(0,10),bed:'23:15',wake:'06:45',hrs:6.5+(i%3)*0.5};});
    save();
    const t = document.getElementById('tour');
    if (t && t.classList.contains('on')) tourEnd();
  });
  await new Promise(r => setTimeout(r, 1600));

  /* Kill entrance animations and transitions for the duration of the
     sweep. They are not what this measures, and mid-flight values made
     it report a handful of failures on roughly one run in three -- a
     check that cries wolf gets ignored, which is worse than not having
     it. */
  await p.addStyleTag({ content:
    '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await new Promise(r => setTimeout(r, 200));

  let problems = 0;
  for (const [w,h,label] of [[1440,900,'desktop'],[820,900,'tablet'],[375,812,'phone']]) {
    await p.setViewport({ width:w, height:h });
    const res = await p.evaluate(async (pages) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const out = [];
      const rgba = s => { const m = String(s).match(/rgba?\(([^)]+)\)/);
        if (!m) return null; const q = m[1].split(',').map(parseFloat);
        return { r:q[0], g:q[1], b:q[2], a:q.length>3?q[3]:1 }; };
      const over = (t,bt) => ({ r:t.r*t.a+bt.r*(1-t.a), g:t.g*t.a+bt.g*(1-t.a),
                                b:t.b*t.a+bt.b*(1-t.a), a:1 });
      const srgb = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
      const lum = c => 0.2126*srgb(c.r)+0.7152*srgb(c.g)+0.0722*srgb(c.b);
      const ratio = (a,bq) => { const l1=lum(a), l2=lum(bq);
        return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
      /* The sky hero paints its gradient on sibling layers, not on an
         ancestor, so walking up finds no image and its text gets judged
         against the page background instead of the sky. Its ink is set
         from script to suit whichever gradient is showing, so it is
         correct by construction; skip it. */
      const bgOf = el => { if (el.closest && el.closest('.sky')) return null;
        const stack=[]; let n=el;
        while (n && n !== document.documentElement) {
          const cs = getComputedStyle(n);
          if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
          const c = rgba(cs.backgroundColor);
          if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
          n = n.parentElement; }
        const root = rgba(getComputedStyle(document.body).backgroundColor)
                  || { r:255,g:255,b:255,a:1 };
        let acc = stack.length && stack[stack.length-1].a === 1 ? stack.pop() : root;
        if (acc.a !== 1) acc = { ...acc, a:1 };
        for (let i=stack.length-1;i>=0;i--) acc = over(stack[i], acc);
        return acc; };

      for (const dark of [false,true]) {
        applyTheme(dark);
        /* body carries `transition: color .3s`, so reading straight
           after the switch catches every inherited colour mid-way
           between the two themes — that alone reported 61 phantom
           failures on one page. */
        await sleep(420);
        for (const id of pages) {
          let threw='';
          try { goPage(id); } catch(e){ threw = e.message; }
          try {
            if (id === 'stopwatch') {
              swLaps = [{n:3,lt:41230,tot:128900},{n:2,lt:52110,tot:87670},
                        {n:1,lt:35560,tot:35560}];
              renderLaps(); swUpdateStats(); swDrawLapChart();
            }
            if (id === 'pomodoro') renderPT();
          } catch(e) { threw = threw || 'prime: ' + e.message; }
          await sleep(50);
          const el = document.getElementById('pg-'+id);
          const main = document.getElementById('main').getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const hs = document.documentElement.scrollWidth > innerWidth+1;
          const mis = Math.abs(r.left - main.left) > 2;
          let clipped = 0, lowC = 0;
          el.querySelectorAll('*').forEach(n => {
            const q = n.getBoundingClientRect();
            const cs = getComputedStyle(n);
            if (q.width > 0 && q.right > innerWidth+2 && cs.position !== 'fixed') {
              let a2 = n.parentElement, reach = false;
              while (a2 && a2 !== document.body) {
                const c2 = getComputedStyle(a2);
                if (/auto|scroll/.test(c2.overflowX)) { reach = true; break; }
                if (c2.overflowX === 'hidden') break;
                a2 = a2.parentElement; }
              if (!reach) clipped++;
            }
            if (n.children.length === 0 && n.textContent.trim() && q.width > 0) {
              const fg = rgba(cs.color), bg = bgOf(n);
              if (fg && bg && fg.a > 0.6) {
                const size = parseFloat(cs.fontSize);
                const need = (size >= 18 || (size >= 14 && +cs.fontWeight >= 700)) ? 3 : 4.5;
                if (ratio(fg, bg) < need) lowC++;
              }
            }
          });
          /* Setting overflow-y:auto makes overflow-x compute to auto too,
             so a page that overflows sideways still looks "reachable by
             scrolling" to the clipping check above. A wide table that
             scrolls inside its own container is the right pattern on a
             phone, though -- what is not is a control you can only reach
             by scrolling sideways. So this looks for buttons, inputs and
             selects sitting outside the visible width. */
          let sideways = 0;
          if (innerWidth <= 700) {
            el.querySelectorAll('button,input,select,textarea,a[href]').forEach(c => {
              const q = c.getBoundingClientRect();
              if (q.width <= 0 || getComputedStyle(c).position === 'fixed') return;
              if (q.left < -2 || q.right > innerWidth + 2) sideways++;
            });
          }
          if (hs||mis||threw||clipped||lowC||sideways)
            out.push(`${dark?'dark ':'light'} ${id}` + (threw?' THREW '+threw:'') +
              (hs?' HSCROLL':'') + (mis?' MISALIGNED':'') +
              (clipped?' CLIPPED='+clipped:'') + (lowC?' LOWCONTRAST='+lowC:'') +
              (sideways?' SIDEWAYS-SCROLL':''));
        }
      }
      applyTheme(false);
      return out;
    }, PAGES);
    console.log(res.length ? `  ${label} (${w}px): ${res.length}\n      ` + res.join('\n      ')
                           : `  ok    ${label} (${w}px): clean`);
    problems += res.length;
  }
  await b.close();
  if (errs.length) console.log('\n' + errs.join('\n'));
  console.log(problems || errs.length ? `\n${problems+errs.length} finding(s)` : '\nsweep clean');
})().catch(e => { console.error('crashed:', e.message); process.exit(1); });
