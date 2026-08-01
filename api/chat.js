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
   pinning a version just means it quietly 404s the day it is retired. */
const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  .concat(['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']);

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'POST only' } });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({ error: { code: 'NO_SERVER_KEY',
      message: 'The server has no GEMINI_API_KEY set.' } });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !Array.isArray(body.messages)) {
    res.status(400).json({ error: { message: 'Expected { messages: [...] }' } });
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
  for (const model of MODELS) {
    let r, text;
    try {
      r = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload)
      });
      text = await r.text();
    } catch (e) {
      lastErr = { status: 502, body: e.message };
      continue;
    }

    if (r.status === 404) { lastErr = { status: 404, body: text }; continue; }  // try next model

    if (!r.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error?.message || text; } catch {}
      res.status(r.status).json({ error: { message: msg } });
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

  res.status(lastErr ? lastErr.status : 502).json({
    error: { message: 'No available Gemini model accepted the request. ' +
      'Tried: ' + MODELS.join(', ') + '. ' + (lastErr ? lastErr.body : '') }
  });
};
