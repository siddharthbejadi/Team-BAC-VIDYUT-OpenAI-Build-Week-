import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScenario } from './public/js/engine.js';
import { TEST_LIBRARY } from './public/js/catalog.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '0.0.0.0';
const model = process.env.OPENAI_MODEL || 'gpt-5.6';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 128_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function safeProfile(raw) {
  const faults = Array.isArray(raw?.faults) ? raw.faults.filter((value) => typeof value === 'string').slice(0, 32) : [];
  if (!raw?.id || !raw?.name || !raw?.family || faults.length === 0) throw new Error('A valid machine profile is required.');
  return {
    id: String(raw.id).slice(0, 80),
    name: String(raw.name).slice(0, 120),
    family: String(raw.family).slice(0, 30),
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String).slice(0, 20) : [],
    faults,
    objective: String(raw.objective || '').slice(0, 500)
  };
}

function normalizeScenario(scenario, profile) {
  const duration = Math.max(8, Math.min(30, Number(scenario.duration) || 18));
  const events = (scenario.events || []).slice(0, 6).map((event, index) => {
    const start = Math.max(1, Math.min(duration - 2, Number(event.start) || 3 + index * 4));
    const eventDuration = Math.max(1, Math.min(duration - start, Number(event.duration) || 4));
    return {
      fault: profile.faults.includes(event.fault) ? event.fault : profile.faults[index % profile.faults.length],
      testId: TEST_LIBRARY.find((test) => test.fault === event.fault)?.id || null,
      start: Number(start.toFixed(1)),
      duration: Number(eventDuration.toFixed(1)),
      severity: Number(Math.max(.1, Math.min(1, Number(event.severity) || .65)).toFixed(2))
    };
  });
  return {
    id: `ai-${profile.id}-${Date.now()}`,
    name: String(scenario.name || 'AI stress test').slice(0, 64),
    intent: String(scenario.intent || 'Validate autonomous response to a realistic sequence of failures.').slice(0, 280),
    duration,
    selectedTestIds: [...new Set(events.map((event) => event.testId).filter(Boolean))],
    events: events.length ? events : [{ fault: profile.faults[0], testId: TEST_LIBRARY.find((test) => test.fault === profile.faults[0])?.id || null, start: 3, duration: 5, severity: .7 }]
  };
}

function fallbackScenario(prompt, profile) {
  const text = prompt.toLowerCase();
  const ranked = profile.faults.map((fault) => {
    const tokens = {
      gnss_drift: ['gnss', 'gps', 'navigation', 'position', 'urban'],
      link_loss: ['link', 'radio', 'communication', 'remote', 'signal'],
      wind_gust: ['wind', 'gust', 'weather', 'storm', 'bridge'],
      motor_loss: ['motor', 'actuator', 'propeller', 'thrust'],
      camera_occlusion: ['camera', 'vision', 'dust', 'dark', 'occlusion'],
      wheel_slip: ['slip', 'rain', 'mud', 'traction', 'wet'],
      imu_bias: ['imu', 'inertial', 'balance', 'drift'],
      joint_torque_loss: ['joint', 'knee', 'ankle', 'torque', 'actuator'],
      battery_sag: ['battery', 'power', 'voltage', 'cold']
    }[fault] || [fault];
    return { fault, score: tokens.reduce((score, token) => score + (text.includes(token) ? 3 : 0), 0) };
  }).sort((a, b) => b.score - a.score);
  const chosen = ranked.slice(0, Math.min(3, ranked.length)).map((entry) => entry.fault);
  return normalizeScenario({
    name: chosen.map((fault) => fault.replaceAll('_', ' ')).join(' + '),
    intent: `Stress ${profile.name} against the mission risk: ${prompt.slice(0, 180)}`,
    duration: 18,
    events: chosen.map((fault, index) => ({ fault, start: 3 + index * 4.4, duration: 4.6, severity: .72 - index * .08 }))
  }, profile);
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  for (const item of payload.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) if (content.type === 'output_text' && content.text) return content.text;
  }
  throw new Error('The model returned no structured scenario.');
}

async function openAiScenario(prompt, profile, environment = {}) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'A short, engineering-style scenario name.' },
      intent: { type: 'string', description: 'One sentence explaining the safety property this test validates.' },
      duration: { type: 'number', minimum: 8, maximum: 30 },
      events: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            fault: { type: 'string', enum: profile.faults },
            start: { type: 'number', minimum: 1, maximum: 25 },
            duration: { type: 'number', minimum: 1, maximum: 12 },
            severity: { type: 'number', minimum: .1, maximum: 1 }
          },
          required: ['fault', 'start', 'duration', 'severity']
        }
      }
    },
    required: ['name', 'intent', 'duration', 'events']
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'system',
            content: `You design safety validation scenarios for autonomous machines. Use only the permitted fault identifiers. Sequence faults realistically, keep every event inside the total duration, and make the result directly executable. State measurable intent but never claim certification. Machine: ${JSON.stringify(profile)}. Environment: ${JSON.stringify(environment)}`
          },
          { role: 'user', content: prompt }
        ],
        text: { format: { type: 'json_schema', name: 'vidyut_failure_scenario', strict: true, schema } },
        max_output_tokens: 900
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status}).`);
    return normalizeScenario(JSON.parse(extractOutputText(payload)), profile);
  } finally {
    clearTimeout(timeout);
  }
}

const LOCAL_COMPONENTS = [
  { tokens: ['pca9685'], component: { id: 'pca9685', name: 'PCA9685 16-channel PWM driver', partNumber: 'PCA9685', manufacturer: 'NXP', kind: 'actuator-controller', input: { minVoltage: 2.3, maxVoltage: 5.5, currentA: .02 }, bus: 'i2c', address: '0x40', pins: [{ id: 'VCC', name: 'VCC', mode: 'power' }, { id: 'GND', name: 'GND', mode: 'ground' }, { id: 'SDA', name: 'SDA', mode: 'i2c' }, { id: 'SCL', name: 'SCL', mode: 'i2c' }, { id: 'PWM0', name: 'PWM0', mode: 'pwm' }], sourceUrl: 'https://www.nxp.com/docs/en/data-sheet/PCA9685.pdf', sourceTitle: 'NXP PCA9685 data sheet' } },
  { tokens: ['mpu6050', 'mpu-6050'], component: { id: 'mpu6050', name: 'MPU-6050 6-axis IMU', partNumber: 'MPU-6050', manufacturer: 'TDK InvenSense', kind: 'sensor', input: { minVoltage: 2.375, maxVoltage: 3.46, currentA: .004 }, bus: 'i2c', address: '0x68', pins: [{ id: 'VCC', name: 'VCC', mode: 'power' }, { id: 'GND', name: 'GND', mode: 'ground' }, { id: 'SDA', name: 'SDA', mode: 'i2c' }, { id: 'SCL', name: 'SCL', mode: 'i2c' }], sourceUrl: 'https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Datasheet1.pdf', sourceTitle: 'TDK MPU-6000/6050 data sheet' } },
  { tokens: ['stm32f4', 'stm32f407'], component: { id: 'stm32f407', name: 'STM32F407 microcontroller', partNumber: 'STM32F407', manufacturer: 'STMicroelectronics', kind: 'controller', input: { minVoltage: 1.8, maxVoltage: 3.6, currentA: .2 }, bus: null, address: null, pins: [{ id: 'VDD', name: 'VDD', mode: 'power' }, { id: 'VSS', name: 'VSS', mode: 'ground' }, { id: 'TX1', name: 'USART1_TX', mode: 'tx' }, { id: 'RX1', name: 'USART1_RX', mode: 'rx' }, { id: 'PWM1', name: 'TIM1_CH1', mode: 'pwm' }], sourceUrl: 'https://www.st.com/resource/en/datasheet/stm32f407vg.pdf', sourceTitle: 'STMicroelectronics STM32F407 data sheet' } },
  { tokens: ['raspberry pi 5', 'rpi5'], component: { id: 'raspberry-pi-5', name: 'Raspberry Pi 5', partNumber: 'SC1112', manufacturer: 'Raspberry Pi', kind: 'controller', input: { minVoltage: 4.75, maxVoltage: 5.25, currentA: 5 }, bus: 'i2c', address: null, pins: [{ id: '5V', name: '5V', mode: 'power' }, { id: 'GND', name: 'GND', mode: 'ground' }, { id: 'SDA', name: 'GPIO2/SDA', mode: 'i2c' }, { id: 'SCL', name: 'GPIO3/SCL', mode: 'i2c' }, { id: 'TX1', name: 'GPIO14/TX', mode: 'tx' }, { id: 'RX1', name: 'GPIO15/RX', mode: 'rx' }], sourceUrl: 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html', sourceTitle: 'Raspberry Pi hardware documentation' } },
  { tokens: ['jetson orin nano', 'orin nano'], component: { id: 'jetson-orin-nano', name: 'Jetson Orin Nano developer kit', partNumber: 'Jetson Orin Nano', manufacturer: 'NVIDIA', kind: 'controller', input: { minVoltage: 9, maxVoltage: 20, currentA: 2.5 }, bus: 'uart', address: null, pins: [{ id: 'VIN', name: 'DC input', mode: 'power' }, { id: 'GND', name: 'GND', mode: 'ground' }, { id: 'TX1', name: 'UART TX', mode: 'tx' }, { id: 'RX1', name: 'UART RX', mode: 'rx' }], sourceUrl: 'https://developer.nvidia.com/embedded/learn/jetson-orin-nano-devkit-user-guide/index.html', sourceTitle: 'NVIDIA Jetson Orin Nano developer kit guide' } }
];

function localComponent(query) {
  const text = query.toLowerCase();
  const match = LOCAL_COMPONENTS.find((entry) => entry.tokens.some((token) => text.includes(token)));
  return match ? JSON.parse(JSON.stringify(match.component)) : null;
}

function extractCitations(payload) {
  const citations = [];
  for (const item of payload.output || []) for (const content of item.content || []) for (const annotation of content.annotations || []) if (annotation.type === 'url_citation') citations.push({ url: annotation.url, title: annotation.title });
  return citations;
}

async function openAiComponent(query) {
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string' }, name: { type: 'string' }, partNumber: { type: 'string' }, manufacturer: { type: 'string' },
      kind: { type: 'string', enum: ['controller','power-source','regulator','sensor','actuator','actuator-controller','module'] },
      input: { type: 'object', additionalProperties: false, properties: { minVoltage: { type: ['number','null'] }, maxVoltage: { type: ['number','null'] }, currentA: { type: ['number','null'] } }, required: ['minVoltage','maxVoltage','currentA'] },
      bus: { type: ['string','null'] }, address: { type: ['string','null'] },
      pins: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, mode: { type: 'string' } }, required: ['id','name','mode'] } },
      sourceUrl: { type: 'string' }, sourceTitle: { type: 'string' }, limitations: { type: 'string' }
    }, required: ['id','name','partNumber','manufacturer','kind','input','bus','address','pins','sourceUrl','sourceTitle','limitations']
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, reasoning: { effort: 'low' }, tools: [{ type: 'web_search' }],
        input: [{ role: 'system', content: 'Find the exact electronic component using manufacturer documentation where possible. Return conservative electrical fields only. Do not infer a rating when sources disagree; use null and explain it in limitations. This draft must always be confirmed by an engineer before hardware use.' }, { role: 'user', content: query }],
        text: { format: { type: 'json_schema', name: 'vidyut_component_draft', strict: true, schema } }, max_output_tokens: 1400
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status}).`);
    return { component: JSON.parse(extractOutputText(payload)), citations: extractCitations(payload) };
  } finally { clearTimeout(timeout); }
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/ai/status' && request.method === 'GET') {
    return json(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY), model, fallback: 'deterministic-local-planner' });
  }
  if (url.pathname === '/api/ai/scenario' && request.method === 'POST') {
    try {
      const body = await readJson(request);
      const prompt = String(body.prompt || '').trim().slice(0, 1200);
      const profile = safeProfile(body.profile);
      if (prompt.length < 8) return json(response, 400, { error: 'Describe the mission risk in at least 8 characters.' });
      let scenario;
      let source;
      if (process.env.OPENAI_API_KEY) {
        scenario = await openAiScenario(prompt, profile, body.environment || {});
        source = 'openai';
      } else {
        scenario = fallbackScenario(prompt, profile);
        source = 'fallback';
      }
      const validation = validateScenario(scenario, profile);
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      return json(response, 200, { scenario, source, model: source === 'openai' ? model : null });
    } catch (error) {
      return json(response, 500, { error: error.name === 'AbortError' ? 'GPT-5.6 timed out; retry or use demo mode.' : error.message });
    }
  }
  if (url.pathname === '/api/ai/component' && request.method === 'POST') {
    try {
      const body = await readJson(request, 32_000);
      const query = String(body.query || '').trim().slice(0, 300);
      if (query.length < 3) return json(response, 400, { error: 'Enter a component name or part number.' });
      const curated = localComponent(query);
      if (curated) return json(response, 200, { component: curated, source: 'curated', citations: [{ url: curated.sourceUrl, title: curated.sourceTitle }], requiresConfirmation: true });
      if (!process.env.OPENAI_API_KEY) return json(response, 404, { error: 'Component is not in the offline starter library. Configure OPENAI_API_KEY for manufacturer-document research, or add it manually.' });
      const result = await openAiComponent(query);
      return json(response, 200, { ...result, source: 'openai-web-search', model, requiresConfirmation: true });
    } catch (error) {
      return json(response, 500, { error: error.name === 'AbortError' ? 'Component research timed out.' : error.message });
    }
  }
  if (url.pathname === '/health') return json(response, 200, { ok: true, service: 'bac-vidyut', schema: 'vidyut.machine.v2', evidence: 'vidyut.evidence.v2', modelConfigured: Boolean(process.env.OPENAI_API_KEY), capabilities: ['machine-import','electrical-validation','scenario-planning','sil','bidirectional-hil','evidence-replay'] });
  return false;
}

async function serveStatic(request, response, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  const filePath = join(root, relative);
  if (!filePath.startsWith(root)) {
    response.writeHead(403); response.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    if (request.method === 'HEAD') response.end(); else response.end(data);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      const handled = await handleApi(request, response, url);
      if (handled !== false) return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`BAC VIDYUT is running at http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
  console.log(process.env.OPENAI_API_KEY ? `GPT-5.6 scenario copilot enabled (${model})` : 'No OPENAI_API_KEY: deterministic demo planner enabled');
});
