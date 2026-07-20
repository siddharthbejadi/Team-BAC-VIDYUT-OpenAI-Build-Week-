const assets = __VIDYUT_ASSET_MAP__;
const assetKeys = Object.keys(assets);
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  for (const item of payload.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) if (content.type === 'output_text' && content.text) return content.text;
  }
  throw new Error('The model returned no structured output.');
}

function extractCitations(payload) {
  const citations = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type === 'url_citation' && annotation.url) citations.push({ url: annotation.url, title: annotation.title || annotation.url });
      }
    }
  }
  return citations;
}

function safeProfile(raw = {}) {
  const suppliedFaults = Array.isArray(raw.faults) ? raw.faults : [];
  const faults = [...new Set(suppliedFaults.map((fault) => String(fault)).filter((fault) => /^[a-z][a-z0-9_]{1,48}$/.test(fault)))].slice(0, 20);
  return {
    name: String(raw.name || 'Autonomous machine').slice(0, 100),
    family: String(raw.family || raw.machineType || 'custom').slice(0, 60),
    mission: String(raw.mission || '').slice(0, 300),
    faults: faults.length ? faults : ['gnss_drift', 'link_loss', 'wind_gust']
  };
}

function normalizeEnvironmentPatch(patch = {}, existing = {}) {
  const defaults = { gravity: 9.80665, airDensity: 1.225, temperature: 20, wind: 0, visibility: 100, latitude: 0, longitude: 0, elevation: 0 };
  const bounded = (key, minimum, maximum) => clamp(patch[key], minimum, maximum, clamp(existing[key], minimum, maximum, defaults[key]));
  return {
    id: `ai-${Date.now().toString(36)}`,
    name: String(patch.name || existing.name || 'AI-proposed environment').slice(0, 100),
    body: String(patch.body || existing.body || 'Earth').slice(0, 60),
    terrain: String(patch.terrain || existing.terrain || 'User-defined terrain').slice(0, 160),
    gravity: bounded('gravity', 0, 30),
    airDensity: bounded('airDensity', 0, 2.5),
    temperature: bounded('temperature', -200, 100),
    wind: bounded('wind', 0, 100),
    visibility: bounded('visibility', 0, 100),
    latitude: bounded('latitude', -90, 90),
    longitude: bounded('longitude', -180, 180),
    elevation: bounded('elevation', -12000, 100000),
    rationale: String(patch.rationale || 'Environment parameters were proposed from the mission description.').slice(0, 300),
    confirmed: false,
    provenance: 'GPT-5.6 proposal; engineer confirmation required before engineering use.'
  };
}

function normalizeScenario(plan, profile) {
  const duration = clamp(plan.duration, 8, 30, 18);
  const events = (Array.isArray(plan.events) ? plan.events : []).filter((event) => profile.faults.includes(event.fault)).slice(0, 4).map((event) => {
    const start = clamp(event.start, 1, Math.max(1, duration - 1), 3);
    return {
      fault: event.fault,
      start,
      duration: clamp(event.duration, 1, Math.max(1, duration - start), 4),
      severity: clamp(event.severity, .1, 1, .7)
    };
  });
  if (!events.length) throw new Error('The model did not return an executable permitted fault.');
  return {
    name: String(plan.name || 'AI validation plan').slice(0, 100),
    intent: String(plan.intent || 'Measure machine response to the configured mission risk.').slice(0, 300),
    duration,
    events
  };
}

async function callOpenAI(apiKey, requestBody, timeoutMs = 28000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status}).`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function openAiScenario(apiKey, model, prompt, profile, environment) {
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      name: { type: 'string' }, intent: { type: 'string' }, duration: { type: 'number', minimum: 8, maximum: 30 },
      events: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, properties: { fault: { type: 'string', enum: profile.faults }, start: { type: 'number', minimum: 1, maximum: 25 }, duration: { type: 'number', minimum: 1, maximum: 12 }, severity: { type: 'number', minimum: .1, maximum: 1 } }, required: ['fault', 'start', 'duration', 'severity'] } },
      environmentPatch: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, body: { type: 'string' }, terrain: { type: 'string' }, gravity: { type: ['number', 'null'] }, airDensity: { type: ['number', 'null'] }, temperature: { type: ['number', 'null'] }, wind: { type: ['number', 'null'] }, visibility: { type: ['number', 'null'] }, latitude: { type: ['number', 'null'] }, longitude: { type: ['number', 'null'] }, elevation: { type: ['number', 'null'] }, rationale: { type: 'string' } }, required: ['name', 'body', 'terrain', 'gravity', 'airDensity', 'temperature', 'wind', 'visibility', 'latitude', 'longitude', 'elevation', 'rationale'] }
    },
    required: ['name', 'intent', 'duration', 'events', 'environmentPatch']
  };
  const payload = await callOpenAI(apiKey, {
    model, reasoning: { effort: 'low' },
    input: [
      { role: 'system', content: `Design an executable safety-validation scenario for this autonomous machine: ${JSON.stringify(profile)}. Use only the permitted fault identifiers, sequence events realistically, keep them inside the duration, and never claim certification. Existing environment: ${JSON.stringify(environment || {})}` },
      { role: 'user', content: prompt }
    ],
    text: { format: { type: 'json_schema', name: 'vidyut_failure_scenario', strict: true, schema } },
    max_output_tokens: 900
  });
  const plan = JSON.parse(extractOutputText(payload));
  return { scenario: normalizeScenario(plan, profile), environmentPatch: normalizeEnvironmentPatch(plan.environmentPatch, environment) };
}

async function openAiComponent(apiKey, model, query) {
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string' }, name: { type: 'string' }, partNumber: { type: 'string' }, manufacturer: { type: 'string' },
      kind: { type: 'string', enum: ['controller', 'power-source', 'regulator', 'sensor', 'actuator', 'actuator-controller', 'module'] },
      input: { type: 'object', additionalProperties: false, properties: { minVoltage: { type: ['number', 'null'] }, maxVoltage: { type: ['number', 'null'] }, currentA: { type: ['number', 'null'] } }, required: ['minVoltage', 'maxVoltage', 'currentA'] },
      bus: { type: ['string', 'null'] }, address: { type: ['string', 'null'] },
      pins: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, mode: { type: 'string' } }, required: ['id', 'name', 'mode'] } },
      sourceUrl: { type: 'string' }, sourceTitle: { type: 'string' }, limitations: { type: 'string' }
    },
    required: ['id', 'name', 'partNumber', 'manufacturer', 'kind', 'input', 'bus', 'address', 'pins', 'sourceUrl', 'sourceTitle', 'limitations']
  };
  const payload = await callOpenAI(apiKey, {
    model, reasoning: { effort: 'low' }, tools: [{ type: 'web_search' }],
    input: [
      { role: 'system', content: 'Research the exact electronic component using manufacturer documentation where possible. Return conservative electrical fields only; use null when sources disagree. This is an unconfirmed engineering draft, never a hardware-safety verdict.' },
      { role: 'user', content: query }
    ],
    text: { format: { type: 'json_schema', name: 'vidyut_component_draft', strict: true, schema } },
    max_output_tokens: 1400
  }, 35000);
  return { component: JSON.parse(extractOutputText(payload)), citations: extractCitations(payload) };
}

async function handleApi(request, url, env) {
  const apiKey = env?.OPENAI_API_KEY || '';
  const model = env?.OPENAI_MODEL || 'gpt-5.6';
  if (url.pathname === '/api/ai/status' && request.method === 'GET') return json(200, { configured: Boolean(apiKey), model, fallback: 'deterministic-browser-planner', runtime: 'sites-worker' });
  if (url.pathname === '/api/ai/scenario' && request.method === 'POST') {
    if (!apiKey) return json(503, { error: 'Live GPT-5.6 is not configured. The browser will use the deterministic local planner.' });
    try {
      const body = await request.json();
      const prompt = String(body.prompt || '').trim().slice(0, 1200);
      if (prompt.length < 8) return json(400, { error: 'Describe the mission risk in at least 8 characters.' });
      const profile = safeProfile(body.profile);
      const result = await openAiScenario(apiKey, model, prompt, profile, body.environment || {});
      return json(200, { ...result, source: 'openai', model });
    } catch (error) {
      return json(error?.name === 'AbortError' ? 504 : 500, { error: error?.name === 'AbortError' ? 'GPT-5.6 timed out; retry or use the deterministic planner.' : String(error?.message || error) });
    }
  }
  if (url.pathname === '/api/ai/component' && request.method === 'POST') {
    if (!apiKey) return json(503, { error: 'Live component research is not configured. Use the offline starter catalog or add the part manually.' });
    try {
      const body = await request.json();
      const query = String(body.query || '').trim().slice(0, 300);
      if (query.length < 3) return json(400, { error: 'Enter a component name or part number.' });
      const result = await openAiComponent(apiKey, model, query);
      return json(200, { ...result, source: 'openai-web-search', model, requiresConfirmation: true });
    } catch (error) {
      return json(error?.name === 'AbortError' ? 504 : 500, { error: error?.name === 'AbortError' ? 'Component research timed out.' : String(error?.message || error) });
    }
  }
  return null;
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json(200, { ok: true, service: 'bac-vidyut-sites', schema: 'vidyut.machine.v2', evidence: 'vidyut.evidence.v2', modelConfigured: Boolean(env?.OPENAI_API_KEY), aiMode: env?.OPENAI_API_KEY ? 'gpt-5.6' : 'browser-fallback', assetCount: assetKeys.length, hasIndex: assetKeys.includes('/index.html') });
    if (url.pathname.startsWith('/api/ai/')) return (await handleApi(request, url, env)) || json(404, { error: 'Unknown API route.' });
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = assets[requested] || (!requested.includes('.') ? assets['/index.html'] : null);
    if (!asset) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(decode(asset.body), { status: 200, headers: { 'content-type': asset.type, 'cache-control': requested === '/index.html' ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' } });
  }
};
