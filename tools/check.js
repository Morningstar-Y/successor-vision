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
