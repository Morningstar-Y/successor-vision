#!/usr/bin/env node
/*
 * Standing safety check for successor-vision's single HTML file.
 *
 * Exists because the same mistake broke the app three times: markup was
 * removed while code still referenced it, and because a top-level throw
 * in a classic script aborts EVERY remaining statement, one dead
 * getElementById took out unrelated features far away from the edit.
 * The Flow Planner calendar died that way — the calendar was fine, the
 * script just never ran far enough to create its state.
 *
 * Run: node tools/check.js
 * Exits non-zero if anything here would break at runtime.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL  ' + msg); };
const pass = (msg) => console.log('  ok    ' + msg);

/* ---------- documents to check: the page, plus the embedded planner ---- */
const docs = [{ name: 'main document', html: src }];

const blob = src.match(/_FP_B64\s*=\s*"([^"]+)"/);
if (blob) {
  docs.push({
    name: 'flow planner (embedded)',
    html: Buffer.from(blob[1], 'base64').toString('utf8')
  });
}

for (const doc of docs) {
  console.log('\n' + doc.name);

  /* ---------- 1. script blocks must parse ---------- */
  const scripts = [...doc.html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).filter(s => s.trim());
  let bad = 0;
  scripts.forEach((code, i) => {
    try { new Function(code); }
    catch (e) { bad++; fail(`script block ${i + 1} does not parse: ${e.message}`); }
  });
  if (!bad) pass(`${scripts.length} script block(s) parse`);

  /* ---------- 2. every referenced id must exist in the markup ----------
     A missing one is not a cosmetic problem: it throws, and the throw
     aborts the rest of the script. */
  const body = doc.html.slice(Math.max(0, doc.html.indexOf('<body')));
  const declared = new Set(
    [...doc.html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
  );
  // ids the code creates at runtime are legitimate; collect assignments too
  [...doc.html.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)].forEach(m => declared.add(m[1]));

  const referenced = new Map();
  for (const m of doc.html.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    referenced.set(m[1], (referenced.get(m[1]) || 0) + 1);
  }

  const dangling = [...referenced.keys()].filter(id => !declared.has(id));
  let realDangling = 0, guarded = 0, dynamic = 0;
  for (const id of dangling) {
    /* Guard idiom: if(!document.getElementById('x')) return — the
       reference is deliberate and cannot throw. */
    if (doc.html.includes(`if(!document.getElementById('${id}'))`)) { guarded++; continue; }
    /* Dynamically-built elements: the id string also appears somewhere
       that is NOT a getElementById call (e.g. passed to a field builder
       that writes id="..." by concatenation). */
    const uses = [...doc.html.matchAll(new RegExp(`['"]${id}['"]`, 'g'))].length;
    const lookups = referenced.get(id);
    if (uses > lookups) { dynamic++; continue; }
    realDangling++;
    fail(`getElementById('${id}') x${lookups} but nothing declares or builds that id`);
  }
  if (!realDangling) {
    pass(`all ${referenced.size} referenced ids resolve` +
      (guarded ? ` (${guarded} guarded)` : '') + (dynamic ? ` (${dynamic} built at runtime)` : ''));
  }

  /* ---------- 2b. no calls to functions that no longer exist ----------
     A rename or a partly-applied edit can leave call sites pointing at a
     deleted helper. Syntax still parses; it throws the moment that path
     runs. This caught three dead helpers after a refactor. */
  /* Comments are prose, not code. Scanning them reported three calls to
     toISOString() that were only ever mentioned in notes about a bug. */
  const allCode = scripts.join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');   // spare the // in http://
  const defined = new Set();
  for (const re of [/function\s+([A-Za-z_$][\w$]*)\s*\(/g,
                    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/g,
                    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g,
                    // object-literal methods: `add(o){...}` / `list(){...}`
                    /(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm]) {
    for (const m of allCode.matchAll(re)) defined.add(m[1]);
  }
  /* Anything ever named as a parameter is bound at call time, so a call
     to it is not dead. `valFn` — a callback passed into mkStatsRow —
     was flagged until this went in. */
  for (const m of allCode.matchAll(/(?:function\s*[\w$]*\s*|=>\s*|\(\s*)\(?([^()]{0,200}?)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/[=:].*$/, '').replace(/^\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
    }
  }

  // project-local helpers only: our own naming, not builtins or libraries
  const localCall = /(?<![\w.$])(_[A-Za-z]\w*|[a-z]{2,}[A-Z]\w*)\s*\(/g;
  const missing = new Map();
  for (const m of allCode.matchAll(localCall)) {
    const fn = m[1];
    if (defined.has(fn)) continue;
    if (/^(if|for|while|switch|catch|return|typeof|function|await|new)$/.test(fn)) continue;
    /* Property or method anywhere in the file. The char class here used
       to be written `[.\w]` inside a template literal, where \w collapses
       to a bare w — so it only ever matched ".foo=" or "wfoo=", and every
       method name leaked through. */
    if (new RegExp(`[.\\w]${fn}\\s*[=:]`).test(allCode)) continue;
    if (new RegExp(`[.?]\\s*${fn}\\s*\\(`).test(allCode)) continue;   // x.toFixed(2)
    if (typeof globalThis[fn] !== 'undefined') continue;
    missing.set(fn, (missing.get(fn) || 0) + 1);
  }

  /* Names that look like calls but are not. Browser globals node has no
     idea about, plus CSS functions that live inside style strings. */
  const NOT_OURS = new Set([
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
    'getComputedStyle', 'matchMedia', 'getSelection', 'scrollTo', 'scrollBy',
    'createImageBitmap', 'queueMicrotask', 'structuredClone', 'reportError',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    // CSS, not JS
    'scaleX', 'scaleY', 'scale3d', 'translateX', 'translateY', 'translate3d',
    'rotateX', 'rotateY', 'rotateZ', 'skewX', 'skewY', 'linearGradient',
    'radialGradient', 'dropShadow', 'cubicBezier', 'colorMix'
  ]);

  /* Was `fn.startsWith('_')` only, which is how a call to a function I
     had simply invented — svConfirm(), no underscore — reached the
     browser and threw. Any camelCase name that nothing in the file
     defines is just as dead as an underscored one. */
  const dead = [...missing.keys()].filter(fn =>
    !NOT_OURS.has(fn) && !allCode.includes(`${fn} =`));
  if (dead.length) dead.forEach(fn => fail(`calls ${fn}() x${missing.get(fn)} but nothing defines it`));
  else pass('no calls to undefined local helpers');

  /* ---------- 2c. no top-level call that runs before its definition ----
     Function declarations hoist inside a script block, never across
     them. An init call placed in an earlier <script> than the function
     it calls throws ReferenceError, and because a top-level throw
     aborts every remaining statement in that block, it silently kills
     unrelated code further down. That is exactly how the wiring for the
     AI rail took out everything after it.

     Only unindented calls are considered: those run immediately on
     load. Anything inside a function body runs later, by which time
     every block has executed. */
  const blockDefs = scripts.map(code => {
    const d = new Set();
    for (const re of [/function\s+([A-Za-z_$][\w$]*)\s*\(/g,
                      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g]) {
      for (const m of code.matchAll(re)) d.add(m[1]);
    }
    return d;
  });
  let ordering = 0;
  scripts.forEach((code, i) => {
    const clean = code.replace(/\/\*[\s\S]*?\*\//g, ' ')
                      .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
    for (const m of clean.matchAll(/^([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const fn = m[1];
      if (/^(if|for|while|switch|catch|return|function|typeof|new|else|do|try)$/.test(fn)) continue;
      if (blockDefs[i].has(fn)) continue;                 // defined in this block
      const definedLater = blockDefs.findIndex(d => d.has(fn));
      if (definedLater > i) {
        ordering++;
        fail(`script block ${i + 1} calls ${fn}() at top level, but ${fn} is not ` +
             `defined until block ${definedLater + 1} — ReferenceError on load, ` +
             `which aborts the rest of block ${i + 1}`);
      }
    }
  });
  if (!ordering) pass('no top-level call runs before its definition');

  /* ---------- 3. balanced divs ---------- */
  const opens = (body.match(/<div\b/g) || []).length;
  const closes = (body.match(/<\/div>/g) || []).length;
  if (opens !== closes) fail(`div imbalance: ${opens} open, ${closes} close`);
  else pass(`divs balanced (${opens})`);

  /* ---------- 4. no Python escapes leaking into JS ----------
     \U0001XXXX is Python syntax; JavaScript prints it literally, which is
     how "U0001f4ca" ended up rendered where an icon belonged. */
  const pyEsc = doc.html.match(/\\U0001[0-9a-fA-F]{4}/g);
  if (pyEsc) fail(`${pyEsc.length} Python-style \\U escape(s) that JS will print literally`);
  else pass('no Python-style escapes');

  /* ---------- 4b. emoji mangled by a 4-hex escape ----------
     "ὄb" in a Python string is U+1F44 followed by a literal "b",
     because \u takes exactly four hex digits — never five. It reaches
     the page as Greek text where an emoji belongs, which is how the
     tour ended up greeting people with "ὄb". Astral characters need a
     surrogate pair (👋) or the literal character. */
  const mangled = doc.html.match(/[ἀ-῿][0-9a-f](?![0-9a-zA-Z])/g);
  if (mangled) fail(`${mangled.length} mangled astral escape(s), e.g. ${JSON.stringify(mangled[0])}` +
                    ` — a \\uXXXX escape swallowed only 4 of 5 hex digits`);
  else pass('no mangled emoji escapes');

  /* ---------- 4c. every var() must be defined in this document ----------
     A single unknown custom property invalidates the WHOLE declaration
     it appears in, and CSS reports nothing. `--accent-glow` exists only
     in the planner's stylesheet; using it in the main sheet silently
     turned the tour's entire box-shadow into `none`, which removed the
     dimming overlay. Nothing failed — it just quietly stopped working. */
  const css = [...doc.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(m => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');          // comments mention var(--r-*) etc.
  const definedVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  // properties the code sets at runtime are defined too, just not in CSS
  for (const m of doc.html.matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) definedVars.add(m[1]);
  for (const m of doc.html.matchAll(/style="[^"]*?(--[\w-]+)\s*:/g)) definedVars.add(m[1]);
  const used = new Map();
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) {   // require a real close/fallback
    used.set(m[1], (used.get(m[1]) || 0) + 1);
  }
  const undef = [...used.keys()].filter(v => !definedVars.has(v));
  if (undef.length) undef.forEach(v =>
    fail(`var(${v}) used x${used.get(v)} but this document never defines it` +
         ` — the whole declaration silently becomes invalid`));
  else pass(`all ${used.size} custom properties are defined`);

  /* ---------- 5. no secrets ---------- */
  const secrets = [
    [/AQ\.Ab8[A-Za-z0-9_-]+/, 'Gemini API key'],
    [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic key'],
    [/svtest\.local|sync-test-passphrase|prefs-test-passphrase/, 'test credentials']
  ];
  let leaked = 0;
  secrets.forEach(([re, what]) => { if (re.test(doc.html)) { leaked++; fail(`${what} present in the bundle`); } });
  if (!leaked) pass('no secrets or test credentials');
}

console.log('\n' + (failures ? `${failures} FAILURE(S)` : 'all checks passed'));
process.exit(failures ? 1 : 0);
