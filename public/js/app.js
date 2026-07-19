import { FAULT_LIBRARY, MACHINE_PROFILES, PRESET_SCENARIOS, cloneScenario, profileFromManifest } from './profiles.js';
import { VidyutEngine } from './engine.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const state = {
  profiles: { ...MACHINE_PROFILES },
  profileId: 'drone',
  scenario: cloneScenario(PRESET_SCENARIOS.drone[0]),
  mode: 'SIL',
  engine: null,
  running: false,
  speed: 1.75,
  lastFrame: performance.now(),
  hardwareSample: null,
  serialPort: null,
  serialReader: null,
  aiConfigured: false,
  guidedDemo: false,
  guidedIndex: 0
};

const dom = {
  machineList: $('#machine-list'),
  manifestInput: $('#manifest-input'),
  scenarioSelect: $('#scenario-select'),
  scenarioSummary: $('#scenario-summary'),
  seedInput: $('#seed-input'),
  speedSelect: $('#speed-select'),
  runBtn: $('#run-btn'),
  resetBtn: $('#reset-btn'),
  connectBtn: $('#connect-btn'),
  connectorTitle: $('#connector-title'),
  connectorDetail: $('#connector-detail'),
  sceneCanvas: $('#scene-canvas'),
  telemetryCanvas: $('#telemetry-canvas'),
  sceneMachineName: $('#scene-machine-name'),
  sceneObjective: $('#scene-objective'),
  runStateDot: $('#run-state-dot'),
  runStateLabel: $('#run-state-label'),
  runClock: $('#run-clock'),
  truthPosition: $('#truth-position'),
  controllerState: $('#controller-state'),
  faultBanner: $('#fault-banner'),
  faultBannerText: $('#fault-banner-text'),
  metricSafety: $('#metric-safety'),
  metricError: $('#metric-error'),
  metricContextLabel: $('#metric-context-label'),
  metricContext: $('#metric-context'),
  metricContextNote: $('#metric-context-note'),
  metricBattery: $('#metric-battery'),
  meterSafety: $('#meter-safety'),
  meterError: $('#meter-error'),
  meterContext: $('#meter-context'),
  meterBattery: $('#meter-battery'),
  metricSafetyNote: $('#metric-safety-note'),
  aiPrompt: $('#ai-prompt'),
  generateBtn: $('#generate-btn'),
  aiMode: $('#ai-mode'),
  aiHelper: $('#ai-helper'),
  eventList: $('#event-list'),
  sequenceSubtitle: $('#sequence-subtitle'),
  seedChip: $('#seed-chip'),
  runtimeTrace: $('#runtime-trace'),
  assertionList: $('#assertion-list'),
  evidenceBtn: $('#evidence-btn'),
  guidedDemoBtn: $('#guided-demo-btn'),
  reportDialog: $('#report-dialog'),
  reportContent: $('#report-content'),
  closeReport: $('#close-report'),
  downloadReport: $('#download-report'),
  downloadCsv: $('#download-csv'),
  toast: $('#toast')
};

function profile() { return state.profiles[state.profileId]; }

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.remove('show'), 2600);
}

function familyGlyph(family) {
  return family.toLowerCase() === 'aerial' ? 'AIR' : family.toLowerCase() === 'legged' ? 'HUM' : 'UGV';
}

function renderMachineList() {
  dom.machineList.innerHTML = Object.values(state.profiles).map((item) => `
    <button class="machine-option ${item.id === state.profileId ? 'active' : ''}" data-profile="${item.id}" style="--machine-accent:${item.accent}">
      <span class="machine-glyph">${familyGlyph(item.family)}</span>
      <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.family)} · ${escapeHtml(item.format)}</small></span>
      <i class="status-dot"></i>
    </button>
  `).join('');
  $$('.machine-option').forEach((button) => button.addEventListener('click', () => selectProfile(button.dataset.profile)));
}

function selectProfile(id, scenarioIndex = 0) {
  if (!state.profiles[id]) return;
  state.profileId = id;
  const scenarios = PRESET_SCENARIOS[id] || [makeDefaultScenario(state.profiles[id])];
  state.scenario = cloneScenario(scenarios[scenarioIndex] || scenarios[0]);
  renderMachineList();
  renderScenarioOptions();
  configureProfileUI();
  resetEngine();
}

function makeDefaultScenario(item) {
  return {
    id: `${item.id}-validation`,
    name: 'Mixed-fault validation',
    intent: 'Exercise the imported machine through two supported degradation modes.',
    duration: 18,
    events: item.faults.slice(0, 2).map((fault, index) => ({ fault, start: 3 + index * 5, duration: 4.5, severity: index ? 0.62 : 0.72 }))
  };
}

function renderScenarioOptions() {
  const scenarios = PRESET_SCENARIOS[state.profileId] || [state.scenario];
  dom.scenarioSelect.innerHTML = scenarios.map((scenario, index) => `<option value="${index}" ${scenario.id === state.scenario.id ? 'selected' : ''}>${escapeHtml(scenario.name)}</option>`).join('');
  dom.scenarioSummary.textContent = state.scenario.intent;
  renderEventList();
}

function configureProfileUI() {
  const item = profile();
  dom.sceneMachineName.textContent = item.name;
  dom.sceneObjective.textContent = item.objective;
  dom.assertionList.innerHTML = item.passRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join('');
  if (item.family.toLowerCase() === 'aerial') {
    dom.metricContextLabel.textContent = 'Attitude';
    dom.metricContextNote.textContent = 'Peak limit 28°';
  } else if (item.family.toLowerCase() === 'legged') {
    dom.metricContextLabel.textContent = 'Joint load';
    dom.metricContextNote.textContent = 'Peak limit 92%';
  } else {
    dom.metricContextLabel.textContent = 'Perception';
    dom.metricContextNote.textContent = 'Minimum 25%';
  }
  dom.aiPrompt.placeholder = item.family.toLowerCase() === 'aerial'
    ? 'Inspect a bridge in gusty weather, then lose GNSS near the final waypoint.'
    : item.family.toLowerCase() === 'legged'
      ? 'Walk through a warehouse while one knee actuator weakens and the IMU slowly drifts.'
      : 'Deliver a parcel through dust, camera occlusion and a low-traction surface.';
}

function resetEngine() {
  state.running = false;
  state.guidedDemo = false;
  const seed = Number(dom.seedInput.value) || 42;
  state.engine = new VidyutEngine(profile(), state.scenario, { seed, mode: state.mode });
  dom.runBtn.textContent = 'Run scenario';
  dom.guidedDemoBtn.textContent = '▶ 60-second judge demo';
  dom.seedChip.textContent = `SEED ${seed}`;
  renderEventList();
  updateUI(state.engine.snapshot());
}

function toggleRun() {
  if (state.engine.state.completed) resetEngine();
  state.running = !state.running;
  dom.runBtn.textContent = state.running ? 'Pause run' : 'Resume run';
  if (state.running) state.lastFrame = performance.now();
}

function renderEventList(snapshot = state.engine?.snapshot()) {
  const t = snapshot?.t || 0;
  dom.sequenceSubtitle.textContent = `${state.scenario.events.length} injected event${state.scenario.events.length === 1 ? '' : 's'}`;
  dom.eventList.innerHTML = state.scenario.events.map((event, index) => {
    const meta = FAULT_LIBRARY[event.fault];
    const active = t >= event.start && t <= event.start + event.duration;
    const progress = clamp((t - event.start) / event.duration, 0, 1) * 100;
    return `<article class="event-item ${active ? 'active' : ''}" style="--event-color:${meta?.color || '#5eead4'}">
      <span class="event-index">${String(index + 1).padStart(2, '0')}</span>
      <b>${escapeHtml(meta?.label || event.fault)}</b>
      <small>T+${event.start.toFixed(1)}s · ${Math.round(event.severity * 100)}% · ${event.duration.toFixed(1)}s</small>
      <span class="event-progress"><i style="width:${progress}%"></i></span>
    </article>`;
  }).join('');
}

function updateUI(snapshot) {
  const minutes = Math.floor(snapshot.t / 60);
  const seconds = snapshot.t % 60;
  dom.runClock.textContent = `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
  dom.runStateLabel.textContent = snapshot.phase;
  dom.runStateDot.className = snapshot.activeFaults.length ? 'fault' : state.running ? 'running' : '';
  dom.truthPosition.textContent = `X ${snapshot.x.toFixed(1)} · Y ${snapshot.y.toFixed(1)}`;
  dom.controllerState.textContent = snapshot.controller;
  dom.faultBanner.hidden = snapshot.activeFaults.length === 0;
  dom.faultBannerText.textContent = snapshot.activeFaults.map((event) => FAULT_LIBRARY[event.fault]?.short || event.fault).join(' + ');

  const safety = clamp(snapshot.stability, 0, 100);
  const error = Math.hypot(snapshot.observedX - snapshot.x, snapshot.observedY - snapshot.y);
  dom.metricSafety.textContent = `${safety.toFixed(0)}%`;
  dom.metricSafetyNote.textContent = safety < 38 ? 'Fallback required' : safety < 65 ? 'Degraded envelope' : 'Inside envelope';
  dom.metricError.textContent = `${error.toFixed(1)} m`;
  dom.metricBattery.textContent = `${snapshot.battery.toFixed(0)}%`;
  dom.meterSafety.style.width = `${safety}%`;
  dom.meterError.style.width = `${clamp(error / 18 * 100, 0, 100)}%`;
  dom.meterBattery.style.width = `${snapshot.battery}%`;
  setMeterColor(dom.meterSafety, safety, true);
  setMeterColor(dom.meterError, error / 18 * 100, false);
  setMeterColor(dom.meterBattery, snapshot.battery, true);

  const family = profile().family.toLowerCase();
  if (family === 'aerial') {
    dom.metricContext.textContent = `${snapshot.attitude.toFixed(1)}°`;
    dom.meterContext.style.width = `${clamp(snapshot.attitude / 35 * 100, 0, 100)}%`;
    setMeterColor(dom.meterContext, snapshot.attitude / 35 * 100, false);
  } else if (family === 'legged') {
    dom.metricContext.textContent = `${snapshot.jointLoad.toFixed(0)}%`;
    dom.meterContext.style.width = `${clamp(snapshot.jointLoad, 0, 100)}%`;
    setMeterColor(dom.meterContext, snapshot.jointLoad, false);
  } else {
    dom.metricContext.textContent = `${snapshot.perception.toFixed(0)}%`;
    dom.meterContext.style.width = `${snapshot.perception}%`;
    setMeterColor(dom.meterContext, snapshot.perception, true);
  }

  renderEventList(snapshot);
  renderTrace(snapshot.logs);
  drawScene(snapshot);
  drawTelemetry(snapshot.telemetry);
  if (snapshot.completed) {
    state.running = false;
    dom.runBtn.textContent = 'Run again';
    if (state.guidedDemo) advanceGuidedDemo();
  }
}

function setMeterColor(element, value, highIsGood) {
  const quality = highIsGood ? value : 100 - value;
  element.style.background = quality < 35 ? 'var(--red)' : quality < 65 ? 'var(--amber)' : 'var(--teal)';
}

function renderTrace(logs) {
  dom.runtimeTrace.innerHTML = logs.slice(-5).map((log) => `<div class="trace-line ${log.level}"><time>${log.t.toFixed(1)}s</time><i></i><span>${escapeHtml(log.text)}</span></div>`).join('');
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function drawScene(snapshot) {
  const { context: ctx, width, height } = resizeCanvas(dom.sceneCanvas);
  ctx.clearRect(0, 0, width, height);
  const map = { left: 28, top: 24, width: width - 56, height: height - 48 };
  const px = (x) => map.left + x / 100 * map.width;
  const py = (y) => map.top + y / 100 * map.height;

  const grad = ctx.createRadialGradient(px(snapshot.x), py(snapshot.y), 5, px(snapshot.x), py(snapshot.y), Math.max(width, height) * .6);
  grad.addColorStop(0, 'rgba(48, 142, 143, .13)');
  grad.addColorStop(1, 'rgba(8, 19, 26, 0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(126, 166, 176, .09)'; ctx.lineWidth = 1;
  for (let x = map.left; x <= map.left + map.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, map.top); ctx.lineTo(x, map.top + map.height); ctx.stroke(); }
  for (let y = map.top; y <= map.top + map.height; y += 32) { ctx.beginPath(); ctx.moveTo(map.left, y); ctx.lineTo(map.left + map.width, y); ctx.stroke(); }

  ctx.save();
  ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(96,165,250,.38)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(px(profile().initial.x), py(profile().initial.y)); ctx.lineTo(px(profile().target.x), py(profile().target.y)); ctx.stroke();
  ctx.restore();

  drawEnvironment(ctx, map, px, py, profile().family.toLowerCase());
  drawTarget(ctx, px(profile().target.x), py(profile().target.y));

  const telemetry = snapshot.telemetry;
  if (telemetry.length > 1) {
    ctx.strokeStyle = profile().accent; ctx.globalAlpha = .42; ctx.lineWidth = 2; ctx.beginPath();
    telemetry.forEach((point, index) => index ? ctx.lineTo(px(point.x), py(point.y)) : ctx.moveTo(px(point.x), py(point.y)));
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  const estimateGap = Math.hypot(snapshot.observedX - snapshot.x, snapshot.observedY - snapshot.y);
  if (estimateGap > .2) {
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#f7b955'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px(snapshot.x), py(snapshot.y)); ctx.lineTo(px(snapshot.observedX), py(snapshot.observedY)); ctx.stroke();
    ctx.beginPath(); ctx.arc(px(snapshot.observedX), py(snapshot.observedY), 8, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  drawMachine(ctx, px(snapshot.x), py(snapshot.y), snapshot, profile());
}

function drawEnvironment(ctx, map, px, py, family) {
  if (family === 'aerial') {
    ctx.fillStyle = 'rgba(96,165,250,.045)'; ctx.strokeStyle = 'rgba(96,165,250,.22)';
    ctx.fillRect(px(48), py(12), map.width * .12, map.height * .65); ctx.strokeRect(px(48), py(12), map.width * .12, map.height * .65);
    ctx.fillStyle = 'rgba(131,160,170,.35)'; ctx.font = '8px ui-monospace'; ctx.fillText('BRIDGE INSPECTION CORRIDOR', px(49), py(16));
  } else if (family === 'ground') {
    ctx.fillStyle = 'rgba(255,122,138,.055)'; ctx.strokeStyle = 'rgba(255,122,138,.25)';
    ctx.fillRect(px(50), py(49), map.width * .16, map.height * .23); ctx.strokeRect(px(50), py(49), map.width * .16, map.height * .23);
    ctx.fillStyle = 'rgba(255,122,138,.55)'; ctx.font = '8px ui-monospace'; ctx.fillText('EXCLUSION ZONE', px(51), py(53));
  } else {
    [38, 56, 72].forEach((x, index) => { ctx.fillStyle = 'rgba(167,139,250,.08)'; ctx.strokeStyle = 'rgba(167,139,250,.22)'; ctx.fillRect(px(x), py(38 + (index % 2) * 20), map.width * .06, map.height * .12); ctx.strokeRect(px(x), py(38 + (index % 2) * 20), map.width * .06, map.height * .12); });
  }
}

function drawTarget(ctx, x, y) {
  ctx.save(); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = '#60a5fa'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 18, y); ctx.lineTo(x + 18, y); ctx.moveTo(x, y - 18); ctx.lineTo(x, y + 18); ctx.stroke();
  ctx.fillStyle = 'rgba(151,190,243,.85)'; ctx.font = '8px ui-monospace'; ctx.fillText('TARGET', x + 19, y - 7); ctx.restore();
}

function drawMachine(ctx, x, y, snapshot, item) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(snapshot.heading * Math.PI / 180);
  ctx.shadowBlur = 18; ctx.shadowColor = item.accent; ctx.strokeStyle = item.accent; ctx.fillStyle = '#0b171f'; ctx.lineWidth = 2;
  const family = item.family.toLowerCase();
  if (family === 'aerial') {
    ctx.beginPath(); ctx.moveTo(-17,-17); ctx.lineTo(17,17); ctx.moveTo(17,-17); ctx.lineTo(-17,17); ctx.stroke();
    [[-18,-18],[18,-18],[-18,18],[18,18]].forEach(([rx,ry]) => { ctx.beginPath(); ctx.arc(rx,ry,7,0,Math.PI*2); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(0,-10); ctx.lineTo(8,8); ctx.lineTo(-8,8); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (family === 'ground') {
    ctx.fillRect(-16,-10,32,20); ctx.strokeRect(-16,-10,32,20); ctx.fillStyle = item.accent;
    [[-12,-13],[10,-13],[-12,11],[10,11]].forEach(([rx,ry]) => ctx.fillRect(rx,ry,7,3));
    ctx.beginPath(); ctx.moveTo(17,0); ctx.lineTo(8,-5); ctx.lineTo(8,5); ctx.closePath(); ctx.fill();
  } else {
    ctx.rotate(-snapshot.heading * Math.PI / 180);
    const gait = Math.sin(snapshot.t * 6) * (snapshot.controller === 'BALANCE HOLD' ? 1 : 5);
    ctx.beginPath(); ctx.arc(0,-17,5,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(0,3); ctx.moveTo(0,-7); ctx.lineTo(-10, gait); ctx.moveTo(0,-7); ctx.lineTo(10,-gait); ctx.moveTo(0,3); ctx.lineTo(-7,17 + gait*.3); ctx.moveTo(0,3); ctx.lineTo(7,17 - gait*.3); ctx.stroke();
  }
  ctx.restore();
}

function drawTelemetry(data) {
  const { context: ctx, width, height } = resizeCanvas(dom.telemetryCanvas);
  ctx.clearRect(0, 0, width, height);
  const left = 29, right = 9, top = 5, bottom = 18;
  const w = width - left - right, h = height - top - bottom;
  ctx.strokeStyle = 'rgba(126,166,176,.09)'; ctx.lineWidth = 1; ctx.font = '7px ui-monospace'; ctx.fillStyle = '#55727c';
  [0,25,50,75,100].forEach((value) => { const y = top + h - value / 100 * h; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(left+w,y); ctx.stroke(); if (value % 50 === 0) ctx.fillText(String(value), 4, y+3); });
  if (data.length < 2) return;
  const maxT = Math.max(state.scenario.duration, data.at(-1).t);
  const x = (t) => left + t / maxT * w;
  const plot = (color, fn) => { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); data.forEach((point,index) => { const y = top + h - clamp(fn(point),0,100)/100*h; index ? ctx.lineTo(x(point.t),y) : ctx.moveTo(x(point.t),y); }); ctx.stroke(); };
  plot('#5eead4', (point) => point.stability);
  plot('#60a5fa', (point) => point.battery);
  plot('#f7b955', (point) => clamp(point.targetDistance * 2, 0, 100));
  ctx.fillStyle = '#55727c'; [0, .5, 1].forEach((p) => ctx.fillText(`${(maxT*p).toFixed(0)}s`, left+w*p-5, height-4));
}

async function generateScenario() {
  const prompt = dom.aiPrompt.value.trim();
  if (!prompt) { toast('Describe a mission risk first.'); dom.aiPrompt.focus(); return; }
  dom.generateBtn.disabled = true;
  dom.generateBtn.innerHTML = '<span>✦</span> Planning failure sequence…';
  try {
    const response = await fetch('/api/ai/scenario', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, profile: profile() })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Scenario generation failed.');
    state.scenario = payload.scenario;
    dom.scenarioSelect.innerHTML = `<option selected>AI · ${escapeHtml(state.scenario.name)}</option>`;
    dom.scenarioSummary.textContent = state.scenario.intent;
    dom.aiMode.textContent = payload.source === 'openai' ? 'GPT-5.6 LIVE' : 'DEMO PLANNER';
    dom.aiHelper.textContent = payload.source === 'openai'
      ? 'GPT-5.6 returned schema-valid test steps. The deterministic runtime executes them.'
      : 'No API key detected: a transparent deterministic planner generated this runnable scenario.';
    resetEngine();
    toast(`Scenario ready: ${state.scenario.name}`);
  } catch (error) {
    toast(error.message);
  } finally {
    dom.generateBtn.disabled = false;
    dom.generateBtn.innerHTML = '<span>✦</span> Generate stress test';
  }
}

async function checkAiStatus() {
  try {
    const response = await fetch('/api/ai/status');
    const payload = await response.json();
    state.aiConfigured = payload.configured;
    dom.aiMode.textContent = payload.configured ? 'GPT-5.6 LIVE' : 'DEMO READY';
  } catch {
    dom.aiMode.textContent = 'DEMO READY';
  }
}

function setMode(mode) {
  state.mode = mode;
  $$('.segmented button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  if (mode === 'SIL') {
    dom.connectorTitle.textContent = 'Controller emulated';
    dom.connectorDetail.textContent = 'Deterministic SIL adapter active';
  } else {
    dom.connectorTitle.textContent = 'Controller bridge ready';
    dom.connectorDetail.textContent = 'Web Serial JSON · demo bridge available';
  }
  resetEngine();
}

async function connectController() {
  if (state.mode !== 'HIL') { setMode('HIL'); toast('Switched to HIL mode. Select connect again for real serial hardware.'); return; }
  if (!('serial' in navigator)) {
    state.hardwareSample = { heading: 0, battery: 100, stability: 100 };
    dom.connectorTitle.textContent = 'Demo controller connected';
    dom.connectorDetail.textContent = 'Synthetic JSON telemetry bridge';
    toast('Browser has no Web Serial; demo HIL bridge connected.');
    return;
  }
  try {
    state.serialPort = await navigator.serial.requestPort();
    await state.serialPort.open({ baudRate: 115200 });
    dom.connectorTitle.textContent = 'Real controller connected';
    dom.connectorDetail.textContent = '115200 baud · newline JSON';
    toast('HIL serial bridge connected.');
    readSerialLoop();
  } catch (error) {
    if (error.name !== 'NotFoundError') toast(`Connection failed: ${error.message}`);
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoderStream();
  state.serialPort.readable.pipeTo(decoder.writable).catch(() => {});
  state.serialReader = decoder.readable.getReader();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await state.serialReader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) {
        try { state.hardwareSample = JSON.parse(line); } catch { /* ignore malformed device lines */ }
      }
    }
  } catch (error) {
    dom.connectorDetail.textContent = `Serial ended: ${error.message}`;
  }
}

async function importManifest(file) {
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    const imported = profileFromManifest(value);
    state.profiles[imported.id] = imported;
    PRESET_SCENARIOS[imported.id] = [makeDefaultScenario(imported)];
    selectProfile(imported.id);
    toast(`${imported.name} adapter loaded.`);
  } catch (error) {
    toast(`Manifest rejected: ${error.message}`);
  } finally {
    dom.manifestInput.value = '';
  }
}

function openEvidence() {
  const report = state.engine.result || state.engine.buildReport(false);
  const metrics = report.metrics;
  dom.reportContent.innerHTML = `
    <section class="report-hero">
      <div class="verdict ${report.verdict === 'PASS' ? '' : 'review'}">${report.verdict}</div>
      <div><h3>${escapeHtml(report.machine.name)} · ${escapeHtml(report.scenario.name)}</h3><p>${escapeHtml(report.scenario.intent)}</p><span class="report-id">${escapeHtml(report.runId)} · ${report.mode} · seed ${report.deterministicSeed}</span></div>
    </section>
    <section class="report-metrics">
      <article><span>Final distance</span><b>${metrics.finalDistance} m</b></article>
      <article><span>Peak est. error</span><b>${metrics.peakEstimateError} m</b></article>
      <article><span>Min safety</span><b>${metrics.minimumSafetyMargin}%</b></article>
      <article><span>Recovery</span><b>${metrics.recoveryTime ?? '—'}${metrics.recoveryTime ? ' s' : ''}</b></article>
    </section>
    <section><div class="eyebrow-row"><span>FINDINGS</span><b>AUTOMATED ENGINEERING EVIDENCE</b></div>${report.findings.map((finding) => `<article class="finding"><span>${escapeHtml(finding.severity)}</span><div><b>${escapeHtml(finding.title)}</b><small>${escapeHtml(finding.evidence)}</small></div></article>`).join('')}</section>`;
  dom.reportDialog.showModal();
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadReport() {
  const report = state.engine.result || state.engine.buildReport(false);
  download(`${report.runId}.json`, JSON.stringify(report, null, 2), 'application/json');
}

function downloadCsv() {
  const data = state.engine.telemetry;
  if (!data.length) { toast('Run the scenario to capture telemetry first.'); return; }
  const headers = ['t','x','y','targetDistance','stability','battery','perception','link','attitude','jointLoad','controller','faults'];
  const rows = data.map((row) => headers.map((key) => `"${String(Array.isArray(row[key]) ? row[key].join('|') : row[key]).replaceAll('"','""')}"`).join(','));
  download(`vidyut-${state.profileId}-telemetry.csv`, [headers.join(','), ...rows].join('\n'), 'text/csv');
}

function startGuidedDemo() {
  state.guidedDemo = true;
  state.guidedIndex = 0;
  dom.guidedDemoBtn.textContent = '■ Stop guided demo';
  runGuidedStage();
}

function runGuidedStage() {
  const stages = ['drone', 'rover', 'humanoid'];
  const id = stages[state.guidedIndex];
  selectProfile(id, 0);
  state.guidedDemo = true;
  dom.guidedDemoBtn.textContent = `■ Demo ${state.guidedIndex + 1}/3 · ${profile().family}`;
  state.speed = 3;
  dom.speedSelect.value = '3';
  state.running = true;
  dom.runBtn.textContent = 'Pause run';
  toast(`Demo ${state.guidedIndex + 1}/3: ${profile().name}`);
}

function advanceGuidedDemo() {
  state.guidedIndex += 1;
  if (state.guidedIndex >= 3) {
    state.guidedDemo = false;
    dom.guidedDemoBtn.textContent = '▶ 60-second judge demo';
    toast('Guided demo complete — three machine families, one evidence runtime.');
    openEvidence();
    return;
  }
  setTimeout(runGuidedStage, 900);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function animationLoop(now) {
  const elapsed = Math.min((now - state.lastFrame) / 1000, .1);
  state.lastFrame = now;
  if (state.running && !state.engine.state.completed) {
    const step = elapsed * state.speed;
    state.engine.step(step, state.hardwareSample);
    updateUI(state.engine.snapshot());
  } else {
    drawScene(state.engine.snapshot());
    drawTelemetry(state.engine.telemetry);
  }
  requestAnimationFrame(animationLoop);
}

function bindEvents() {
  dom.scenarioSelect.addEventListener('change', () => {
    const scenarios = PRESET_SCENARIOS[state.profileId];
    if (scenarios?.[Number(dom.scenarioSelect.value)]) {
      state.scenario = cloneScenario(scenarios[Number(dom.scenarioSelect.value)]);
      dom.scenarioSummary.textContent = state.scenario.intent;
      resetEngine();
    }
  });
  dom.seedInput.addEventListener('change', resetEngine);
  dom.speedSelect.addEventListener('change', () => { state.speed = Number(dom.speedSelect.value); });
  dom.runBtn.addEventListener('click', toggleRun);
  dom.resetBtn.addEventListener('click', resetEngine);
  dom.generateBtn.addEventListener('click', generateScenario);
  dom.connectBtn.addEventListener('click', connectController);
  dom.manifestInput.addEventListener('change', () => importManifest(dom.manifestInput.files[0]));
  $$('.segmented button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  dom.evidenceBtn.addEventListener('click', openEvidence);
  dom.closeReport.addEventListener('click', () => dom.reportDialog.close());
  dom.downloadReport.addEventListener('click', downloadReport);
  dom.downloadCsv.addEventListener('click', downloadCsv);
  dom.guidedDemoBtn.addEventListener('click', () => {
    if (state.guidedDemo) { state.guidedDemo = false; state.running = false; dom.guidedDemoBtn.textContent = '▶ 60-second judge demo'; }
    else startGuidedDemo();
  });
  window.addEventListener('resize', () => updateUI(state.engine.snapshot()));
}

function init() {
  renderMachineList();
  renderScenarioOptions();
  configureProfileUI();
  resetEngine();
  bindEvents();
  checkAiStatus();
  requestAnimationFrame(animationLoop);
}

init();
