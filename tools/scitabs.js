/* The sleep-science tabs moved from ~200 chars of inline style each
   into a class. Check they still look and behave like tabs, and that
   the active state clears AA in both themes -- the modal is somewhere
   the page sweep never reaches. */
const puppeteer = require('puppeteer');
(async()=>{const b=await puppeteer.launch({args:['--no-sandbox']});const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.setViewport({width:1440,height:940,deviceScaleFactor:2});
await p.goto(require('url').pathToFileURL(require('path').join(__dirname,'..','index.html')).href,{waitUntil:'load'});
await p.evaluate(()=>{S.tourDone=1;S.sleepAge=30;S.sleepProfile='adult';save();
  const t=document.getElementById('tour');if(t&&t.classList.contains('on'))tourEnd();});
await new Promise(r=>setTimeout(r,1400));
const R=[];const ok=(n,c,x)=>R.push((c?'PASS  ':'FAIL  ')+n+(c?'':'   -> '+x));
const srgb=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const lum=a=>0.2126*srgb(a[0])+0.7152*srgb(a[1])+0.0722*srgb(a[2]);
const ratio=(a,c)=>{const l1=lum(a),l2=lum(c);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)};
for(const [dark,tag] of [[false,'light'],[true,'dark']]){
  await p.evaluate(d=>applyTheme(d),dark); await new Promise(r=>setTimeout(r,450));
  await p.evaluate(()=>{goPage('sleep'); slpSciOpen();});
  await new Promise(r=>setTimeout(r,500));
  const t = await p.evaluate(()=>{
    const tabs=[...document.querySelectorAll('.sci-tab')];
    if(!tabs.length) return null;
    const on=tabs.find(x=>x.classList.contains('on'))||tabs[0];
    const cs=getComputedStyle(on), q=on.getBoundingClientRect();
    const par=(s)=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    return {n:tabs.length, inline:tabs.filter(x=>x.getAttribute('style')).length,
      radius:cs.borderRadius, pad:cs.padding, h:Math.round(q.height),
      fg:par(cs.color), bg:(function(){
        /* composite the tab's own background over its parent -- reading
           an rgba() as opaque is what made this report 1.00:1 */
        const own=(cs.backgroundColor.match(/[\d.]+/g)||[]).map(Number);
        const al=own.length>3?own[3]:1;
        let n=on.parentElement, base=[255,255,255];
        while(n){const c=(getComputedStyle(n).backgroundColor.match(/[\d.]+/g)||[]).map(Number);
          if(c.length&&(c.length<4||c[3]===1)){base=c.slice(0,3);break} n=n.parentElement;}
        return own.slice(0,3).map((v,i)=>v*al+base[i]*(1-al));
      })(), size:cs.fontSize,
      heights:tabs.map(x=>Math.round(x.getBoundingClientRect().height))};});
  ok(tag+': four tabs render', t && t.n===4, JSON.stringify(t));
  if(t){
    ok(tag+': no inline styles left', t.inline===0, t.inline);
    ok(tag+': all tabs the same height', new Set(t.heights).size===1, JSON.stringify(t.heights));
    ok(tag+': top corners rounded only', /^(6|8)px (6|8)px 0(px)? 0(px)?$/.test(t.radius), t.radius);
    const r=ratio(t.fg,t.bg);
    ok(tag+': active tab label clears AA', r>=4.5, r.toFixed(2)+':1');
  }
  await p.screenshot({path:`sci-${tag}.png`, clip:await p.evaluate(()=>{
    const m=document.querySelector('.sci-tab').closest('div').getBoundingClientRect();
    return {x:Math.round(m.left)-8,y:Math.round(m.top)-8,width:Math.round(m.width)+16,height:120};})});
  await p.evaluate(()=>{const c=document.querySelector('#slp-sci .modal-x,#slp-sci button');if(c)c.click();
    document.querySelectorAll('.modal.on,.on').forEach(()=>{});});
  await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,250));
}
await b.close();
console.log(R.join('\n'));
if(errs.length) console.log('\nerrors: '+errs.join(' | '));
const f=R.filter(l=>l.startsWith('FAIL')).length+errs.length;
console.log(f?`\n${f} FAILURE(S)`:'\nscience tabs verified');
process.exit(f?1:0);})().catch(e=>{console.error('crashed:',e.message);process.exit(1)});
