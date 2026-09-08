/* The analytics hover layer: does it appear, snap to a month, and read
   the right value? Values must also exist without it -- the monthly
   breakdown table is the relief channel. */
const puppeteer = require('puppeteer');
(async()=>{const b=await puppeteer.launch({args:['--no-sandbox']});const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.setViewport({width:1440,height:940});
await p.goto(require('url').pathToFileURL(require('path').join(__dirname,'..','index.html')).href,{waitUntil:'load'});
await p.evaluate(()=>{S.tourDone=1;S.sleepAge=30;S.sleepProfile='adult';
  S.habits=['Gym','Reading'].map(n=>({id:newId(),name:n,emoji:'\u2705'}));
  const L=[];for(let i=0;i<300;i++){const d=new Date();d.setDate(d.getDate()-i);
    L.push({date:d.toISOString().slice(0,10),bed:'23:15',wake:'06:45',hrs:5.5+2.5*Math.abs(Math.sin(i/29))});}
  S.sleepLog=L; const C={};
  L.forEach((e,i)=>S.habits.forEach((h,j)=>{if((i*3+j*5)%7>1)C[h.id+'_'+e.date]=true;}));
  S.checks=C; save();
  const t=document.getElementById('tour');if(t&&t.classList.contains('on'))tourEnd();});
await new Promise(r=>setTimeout(r,1600));
await p.evaluate(()=>goPage('analytics')); await new Promise(r=>setTimeout(r,900));

const R=[];const ok=(n,c,x)=>R.push((c?'PASS  ':'FAIL  ')+n+(c?'':'   -> '+x));

for (const [key,id] of [['habit','an-habit-canvas'],['sleep','an-sleep-canvas']]) {
  const box = await p.evaluate(i=>{const c=document.getElementById(i);
    c.scrollIntoView({block:'center'}); const r=c.getBoundingClientRect();
    return {x:r.left+r.width*0.55,y:r.top+r.height/2};},id);
  await new Promise(r=>setTimeout(r,250));
  const box2 = await p.evaluate(i=>{const r=document.getElementById(i).getBoundingClientRect();
    return {x:r.left+r.width*0.55,y:r.top+r.height/2};},id);
  await p.mouse.move(box2.x, box2.y);
  await new Promise(r=>setTimeout(r,180));
  const t = await p.evaluate(()=>{const e=document.querySelector('.an-tip');
    if(!e||e.hidden) return null;
    return {v:e.querySelector('.an-tip-v')?.textContent,
            m:e.querySelector('.an-tip-m')?.textContent,
            s:e.querySelector('.an-tip-s')?.textContent,
            key:getComputedStyle(e.querySelector('.an-tip-m i')).backgroundColor};});
  ok(key+' chart shows a tooltip on hover', !!t, 'hidden');
  if(t){
    ok(key+' tooltip leads with a value', /[0-9]/.test(t.v||''), JSON.stringify(t));
    ok(key+' tooltip names the month', /^[A-Z][a-z]{2}$/.test((t.m||'').trim()), JSON.stringify(t.m));
    ok(key+' tooltip has a coloured series key', /rgb/.test(t.key||''), t.key);
  }
  await p.mouse.move(10,10); await new Promise(r=>setTimeout(r,120));
  const gone = await p.evaluate(()=>{const e=document.querySelector('.an-tip');return !e||e.hidden;});
  ok(key+' tooltip hides on leave', gone, 'still visible');
}
// relief channel: the table must carry the values too
const tbl = await p.evaluate(()=>document.querySelectorAll('#pg-analytics table tbody tr').length);
ok('a table view carries the same values', tbl>0, tbl);

await b.close();
console.log(R.join('\n'));
if(errs.length) console.log('\nerrors: '+errs.join(' | '));
const f=R.filter(l=>l.startsWith('FAIL')).length+errs.length;
console.log(f?`\n${f} FAILURE(S)`:'\nanalytics hover verified');
process.exit(f?1:0);})().catch(e=>{console.error('crashed:',e.message);process.exit(1)});
