/* Is anything left permanently underneath the floating AI button?

   Content passing under it mid-scroll is the pattern working as
   intended, so every scrollable region is scrolled to its end first --
   what matters is whether something is still trapped there. */
const puppeteer = require('puppeteer');
const PAGES=['home','ai','dashboard','sleep','todo','stopwatch','pomodoro','analytics','diary','profile','settings'];
const VIEWS=[[1440,940,'desktop'],[820,900,'tablet'],[375,812,'phone']];

(async () => {
  const b = await puppeteer.launch({ args:['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({width:1440,height:940});
  await p.goto(require('url').pathToFileURL(require('path').join(__dirname,'..','index.html')).href,{waitUntil:'load'});
  await p.evaluate(()=>{ S.tourDone=1; S.sleepAge=30; S.sleepProfile='adult';
    S.habits=['Gym','Reading'].map(n=>({id:newId(),name:n,emoji:'\u2705'}));
    S.pomoTasks=[{id:newId(),text:'Write the brief'}];
    S.sleepLog=Array.from({length:8},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);
      return{date:d.toISOString().slice(0,10),bed:'23:15',wake:'06:45',hrs:7};});
    save(); const t=document.getElementById('tour'); if(t&&t.classList.contains('on'))tourEnd(); });
  await new Promise(r=>setTimeout(r,1400));
  await p.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});

  // record laps so the stopwatch's chart strip actually exists
  await p.evaluate(()=>{ goPage('stopwatch'); swToggle(); });
  for(let i=0;i<3;i++){ await new Promise(r=>setTimeout(r,260)); await p.evaluate(()=>swLap()); }
  await p.evaluate(()=>swToggle());

  let total = 0;
  for (const [w,h,label] of VIEWS) {
    await p.setViewport({width:w,height:h});
    await new Promise(r=>setTimeout(r,400));
    const res = await p.evaluate(async pages=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      /* Resolve the button once, on a page where it is shown, and keep
         that element. Re-detecting per page picked up the AI page's own
         fixed composer -- which is not the floating button, and is not
         hidden by it -- and reported it against itself. */
      goPage('home'); await sleep(120);
      const fab=[...document.querySelectorAll('*')].filter(n=>{
        const cs=getComputedStyle(n); if(cs.position!=='fixed')return false;
        const q=n.getBoundingClientRect();
        return q.width>0&&q.width<110&&q.bottom>innerHeight-140&&q.right>innerWidth-140;
      }).pop();
      if(!fab) return ['no floating control found'];
      const out=[];
      for(const id of pages){
        goPage(id); await sleep(90);
        /* It hides itself on the AI page -- nothing to sit on top of. */
        const fcs=getComputedStyle(fab);
        if(fcs.display==='none'||fcs.visibility==='hidden'||+fcs.opacity===0) continue;
        const f=fab.getBoundingClientRect();
        if(!(f.width>0)) continue;
        const root=document.getElementById('pg-'+id);
        [root,...root.querySelectorAll('*')].forEach(n=>{
          const cs=getComputedStyle(n);
          if(/auto|scroll/.test(cs.overflowY)&&n.scrollHeight>n.clientHeight)
            n.scrollTop=n.scrollHeight;
        });
        await sleep(150);
        const hits=new Set();
        root.querySelectorAll('*').forEach(n=>{
          if(getComputedStyle(n).position==='fixed')return;
          const q=n.getBoundingClientRect();
          if(!(q.width>0&&q.height>0))return;
          const ov=Math.min(q.right,f.right)-Math.max(q.left,f.left);
          const oy=Math.min(q.bottom,f.bottom)-Math.max(q.top,f.top);
          if(ov>6&&oy>6&&(n.tagName==='CANVAS'||n.tagName==='INPUT'||n.tagName==='BUTTON'||
             n.tagName==='SELECT'||(n.children.length===0&&n.textContent.trim())))
            hits.add(`${n.tagName.toLowerCase()}.${String(n.className).slice(0,26)} ${Math.round(ov)}x${Math.round(oy)}`);
        });
        if(hits.size) out.push(`    ${id}: ${[...hits].join(' | ')}`);
      }
      return out;
    }, PAGES);
    console.log(res.length ? `  ${label} (${w}px): ${res.length}\n`+res.join('\n')
                           : `  ok    ${label} (${w}px): nothing trapped`);
    total += res.length;
  }
  await b.close();
  console.log(total ? `\n${total} finding(s)` : '\nnothing trapped under the floating button');
  process.exit(total?1:0);
})().catch(e=>{console.error('crashed:',e.message);process.exit(1)});
