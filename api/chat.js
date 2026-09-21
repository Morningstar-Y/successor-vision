/* Server-side proxy between the app and the Gemini API.
 *
 * The whole point of this file is that the API key never reaches the
 * browser. index.html is served publicly, so a key placed there would be
 * readable with View Source and scraped within hours. Here it lives in
 * GEMINI_API_KEY, a Vercel environment variable that only the function
 * runtime can see.
 *
 * The app speaks Anthropic's tool-use shape throughout its chat loop, so
 * rather than rewrite that loop this translates in both directions.
 * Gemini's model turns carry a thought_signature that must be echoed back
 * verbatim on the next request or multi-step tool calls break, so each
 * translated block keeps its original Gemini part under `_g` and we
 * reuse that on the way back instead of trying to reconstruct it.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/* Tried in order, so a key without access to a given model still works
   instead of failing with an opaque 404. `gemini-flash-latest` leads
   because it is an alias Google repoints at the current flash model —
   pinning a version just means it quietly 404s the day it is retired.
   gemini-2.0-flash was retired (Google now answers 404 and names
   gemini-3.6-flash as its replacement). */
const DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-2.5-flash'];
const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  .concat(DEFAULT_MODELS.filter(m => m !== process.env.GEMINI_MODEL));

/* Transient upstream states. These say "this model, right now" -- never
   "this request is wrong" -- so they should move on to the next model
   rather than surface to the user. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/* Gemini's REST Schema.type is an enum of STRING/NUMBER/OBJECT/... */
function upperTypes(schema) {
  if (Array.isArray(schema)) return schema.map(upperTypes);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase();
    else if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, upperTypes(s)]));
    } else out[k] = upperTypes(v);
  }
  return out;
}

/* Anthropic messages -> Gemini contents. */
function toGemini(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') {
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
    }
    const blocks = m.content || [];

    /* Tool results are their own user turn in Gemini. */
    if (blocks.some(b => b.type === 'tool_result')) {
      return {
        role: 'user',
        parts: blocks.filter(b => b.type === 'tool_result').map(b => ({
          functionResponse: {
            name: b._name || 'tool',
            response: { result: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) }
          }
        }))
      };
    }

    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: blocks.map(b => {
        if (b._g) return b._g;                                   // verbatim, keeps thought_signature
        if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input || {} } };
        return { text: b.text || '' };
      })
    };
  });
}

/* Gemini candidate -> Anthropic content blocks. */
function fromGemini(parts) {
  const out = [];
  let n = 0;
  for (const p of parts || []) {
    if (p.functionCall) {
      out.push({
        type: 'tool_use',
        id: 'call_' + (++n) + '_' + Date.now(),
        name: p.functionCall.name,
        input: p.functionCall.args || {},
        _g: p
      });
    } else if (typeof p.text === 'string' && p.text !== '') {
      out.push({ type: 'text', text: p.text, _g: p });
    }
  }
  return out;
}

/* The endpoint is public, so a request is not from this app just because
   it says so. These are the tools the app defines and the models it asks
   for; anything else is refused rather than proxied to a paid API.
   Keep in step with _aiTools in index.html. */
const TOOLS = new Set(['add_habit', 'rename_habit', 'delete_habit', 'set_habit_day',
  'add_task', 'complete_task', 'delete_task', 'log_sleep', 'delete_sleep',
  'write_journal', 'read_journal', 'focus_timer', 'set_setting', 'show_page', 'navigate_to']);
const CLIENT_MODELS = new Set(DEFAULT_MODELS);

/* Per-request cost ceiling. The edge rate limit caps how MANY requests get
   through; these cap how expensive any one of them can be, so the two
   together bound the spend. A real turn is ~9KB: a 4KB system prompt, 5KB
   of tool schemas and a handful of short messages. */
const LIMIT = { body: 120000, messages: 60000, message: 30000, count: 40, system: 20000, tools: 20000 };

/* Returns a refusal reason, or null when the body is shaped like something
   this app sends. 'TOO_LONG' is answered with 413 because the app has a
   specific "clear the chat" message for it; everything else is a 400.
   Without this a message whose content was an object (not a string or a
   list of blocks) reached toGemini and threw. */
function checkBody(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages))
    return 'Expected { messages: [...] }';
  if (body.messages.length > LIMIT.count) return 'TOO_LONG';
  for (const m of body.messages) {
    if (!m || typeof m !== 'object') return 'A message is not an object';
    if (m.role !== 'user' && m.role !== 'assistant') return 'A message has an unknown role';
    const c = m.content;
    if (!(typeof c === 'string' ||
          (Array.isArray(c) && c.every(b => b && typeof b === 'object' && typeof b.type === 'string'))))
      return 'A message has unreadable content';
    if (Array.isArray(c) && c.some(b => typeof b.name === 'string' && !TOOLS.has(b.name)))
      return 'That tool is not part of this app';
    if (JSON.stringify(m).length > LIMIT.message) return 'TOO_LONG';
  }
  if (JSON.stringify(body.messages).length > LIMIT.messages) return 'TOO_LONG';
  if (body.system != null && typeof body.system !== 'string') return 'The system prompt is not text';
  if (body.system && body.system.length > LIMIT.system) return 'TOO_LONG';
  if (body.tools != null) {
    if (!Array.isArray(body.tools)) return 'tools is not a list';
    if (body.tools.length > TOOLS.size) return 'too many tools';
    for (const t of body.tools) {
      if (!t || typeof t !== 'object' || !TOOLS.has(t.name)) return 'That tool is not part of this app';
      if (t.input_schema != null && (typeof t.input_schema !== 'object' || Array.isArray(t.input_schema)))
        return 'A tool schema is not an object';
    }
    if (JSON.stringify(body.tools).length > LIMIT.tools) return 'TOO_LONG';
  }
  if (body.model != null && !CLIENT_MODELS.has(body.model)) return 'That model is not one this app uses';
  if (body.max_tokens != null && (typeof body.max_tokens !== 'number' || !(body.max_tokens > 0)))
    return 'max_tokens is not a number';
  return null;
}

async function handle(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'POST only' } });
    return;
  }

  /* Only this app's own page has a reason to call this, and it calls it
     from this origin with JSON. A cross-origin POST with Content-Type
     text/plain is a "simple request": no CORS preflight, so the browser
     sends it and the function runs whether or not the reply is readable
     — and the attacker never needs to read it, the quota is already
     spent. It is spent on the victim's IP too, which is exactly what
     the per-IP edge limit counts, so that limit does not help here.
     Both halves matter: the origin check turns away the foreign page,
     the content-type check removes the trick that skipped the preflight
     in the first place. A missing Origin is a server-side caller (curl,
     a health check), not a page, and is allowed. */
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = req.headers.origin;
  let sameOrigin = !origin;
  if (origin) { try { sameOrigin = new URL(origin).host === host; } catch { sameOrigin = false; } }
  const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!sameOrigin || ctype !== 'application/json') {
    /* Deliberately says nothing about which half refused. */
    res.status(403).json({ error: { message: 'This endpoint only answers the app itself.' } });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({ error: { code: 'NO_SERVER_KEY',
      message: 'The server has no GEMINI_API_KEY set.' } });
    return;
  }

  /* Refused on the header, before the body is read into memory. */
  if (Number(req.headers['content-length']) > LIMIT.body) {
    res.status(413).json({ error: { code: 'TOO_LARGE',
      message: 'That conversation is too long. Clear the chat and start again.' } });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }

  const bad = body && JSON.stringify(body).length > LIMIT.body ? 'TOO_LONG' : checkBody(body);
  if (bad === 'TOO_LONG') {
    res.status(413).json({ error: { code: 'TOO_LARGE',
      message: 'That conversation is too long. Clear the chat and start again.' } });
    return;
  }
  if (bad) {
    res.status(400).json({ error: { message: bad } });
    return;
  }

  const payload = {
    contents: toGemini(body.messages),
    generationConfig: { maxOutputTokens: Math.min(body.max_tokens || 1000, 4000) }
  };
  if (body.system) payload.systemInstruction = { parts: [{ text: String(body.system) }] };
  if (Array.isArray(body.tools) && body.tools.length) {
    payload.tools = [{
      functionDeclarations: body.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: upperTypes(t.input_schema || { type: 'object', properties: {} })
      }))
    }];
  }

  let lastErr = null;
  const tried = [];   // every model's outcome, for the log: only the last reached it before
  for (const model of MODELS) {
    let r, text;
    /* One quick retry per model. Capacity spikes are usually seconds
       long, and a single 700ms wait recovers most of them without
       risking the function's own timeout. */
    let attempt = 0;
    while (true) {
      try {
        r = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(payload)
        });
        text = await r.text();
      } catch (e) {
        r = null;
        lastErr = { status: 502, body: e.message, model };
      }
      if (r && !RETRYABLE.has(r.status)) break;
      if (attempt >= 1) break;
      attempt++;
      await new Promise(ok => setTimeout(ok, 700));
    }
    if (!r) { tried.push(model + ':network'); continue; }
    if (!r.ok) tried.push(model + ':' + r.status + ' ' + String(text || '').slice(0, 200).replace(/\s+/g, ' '));

    /* Anything transient means "try the next model", not "give up".
       Only 404 used to fall through, so a single overloaded model
       returned 503 to the user while two perfectly healthy fallbacks
       sat untried — which is what "the AI stopped answering" was. */
    if (RETRYABLE.has(r.status)) {
      lastErr = { status: r.status, body: text, model };
      continue;
    }
    if (r.status === 404) { lastErr = { status: 404, body: text, model }; continue; }

    if (!r.ok) {
      /* A real error (bad key, bad request). Trying other models cannot
         help. The upstream body stays in the server log: it can name
         quota, project and model internals, and the user can do nothing
         with any of it. */
      console.error('[api/chat] upstream', r.status, model, text && text.slice(0, 2000));
      res.status(r.status).json({ error: { message: 'The model could not answer that. Try again in a moment.' } });
      return;
    }

    let data;
    try { data = JSON.parse(text); } catch {
      res.status(502).json({ error: { message: 'Unreadable response from the model.' } });
      return;
    }

    const cand = (data.candidates || [])[0];
    const content = fromGemini(cand && cand.content && cand.content.parts);
    const usedTool = content.some(b => b.type === 'tool_use');

    if (!content.length) {
      /* Safety block or an empty finish - say which, rather than going silent. */
      const why = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || 'EMPTY';
      content.push({ type: 'text', text: why === 'SAFETY' || why === 'PROHIBITED_CONTENT'
        ? 'That one got filtered before it reached me. Try rephrasing it.'
        : 'The model returned nothing that time. Send it again.' });
    }

    res.status(200).json({
      content,
      stop_reason: usedTool ? 'tool_use' : 'end_turn',
      model
    });
    return;
  }

  if (lastErr) console.error('[api/chat] no model accepted the request', lastErr.status,
    lastErr.model, lastErr.body && String(lastErr.body).slice(0, 2000), '| tried:', tried.join(' || '));
  res.status(lastErr ? lastErr.status : 502).json({
    error: { message: lastErr && RETRYABLE.has(lastErr.status)
      ? 'Every model is busy right now. This is usually brief — try again in a moment.'
      : 'No available model accepted the request. Try again in a moment.' }
  });
}

/* Nothing unexpected should reach the platform's own 500 page: that tells
   the user nothing and tells us nothing either. */
module.exports = async (req, res) => {
  try { await handle(req, res); }
  catch (e) {
    console.error('[api/chat] unhandled:', (e && e.stack) || e);
    if (!res.headersSent) res.status(500).json({ error: { message: 'Something went wrong on the server.' } });
  }
};
