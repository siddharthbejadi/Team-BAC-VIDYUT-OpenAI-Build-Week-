import { ENVIRONMENTS, FAULT_LIBRARY, TEST_LIBRARY, scenarioFromTests } from './catalog.js';
import { MACHINE_PROFILES, PRESET_SCENARIOS, cloneScenario, profileFromManifest } from './profiles.js';
import { createStarterManifest, importMachineFiles, normalizeMachineManifest, validateMachineManifest } from './manifest.js';
import { VidyutEngine } from './engine.js';
import { HilBridge } from './hil.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hil = new HilBridge();

const state = {
  page: 'machine',
  profiles: clone(MACHINE_PROFILES),
  profileId: 'drone',
  manifest: clone(MACHINE_PROFILES.drone.manifest),
  validation: null,
  environment: clone(ENVIRONMENTS[0]),
  selectedTestIds: clone(PRESET_SCENARIOS.drone[0].selectedTestIds),
  scenario: cloneScenario(PRESET_SCENARIOS.drone[0]),
  testFilter: 'All',
  testSearch: '',
  mode: 'SIL',
  engine: null,
  running: false,
  speed: 1.75,
  lastFrame: performance.now(),
  hardwareSample: null,
  actuatorCommand: null,
  aiConfigured: false,
  importNotices: [],
  evidence: null,
  guided: false
};

const dom = {
  projectName: $('#header-project-name'), runtimeHealth: $('#runtime-health'), presetList: $('#preset-list'), machineFiles: $('#machine-files'), dropzone: $('#machine-dropzone'), importNotices: $('#import-notices'), sourceFiles: $('#source-files'),
  physicsConfirmed: $('#physics-confirmed'), componentRows: $('#component-rows'), connectionRows: $('#connection-rows'), geometrySummary: $('#geometry-summary'), readinessTitle: $('#readiness-title'), readinessRing: $('#readiness-ring'), readinessScore: $('#readiness-score'), readinessCounts: $('#readiness-counts'), readinessIssues: $('#readiness-issues'),
  environmentGrid: $('#environment-grid'), environmentEditor: $('#environment-editor'), testFilters: $('#test-filters'), testSearch: $('#test-search'), testLibrary: $('#test-library'), planTitle: $('#plan-title'), planDuration: $('#plan-duration'), planEnvironment: $('#plan-environment'), planEvents: $('#plan-events'), seedInput: $('#seed-input'), speedSelect: $('#speed-select'),
  aiPrompt: $('#ai-prompt'), aiMode: $('#ai-mode'), aiHelper: $('#ai-helper'), generateBtn: $('#generate-btn'),
  runMachineCard: $('#run-machine-card'), runEnvironmentCard: $('#run-environment-card'), connectorTitle: $('#connector-title'), connectorDetail: $('#connector-detail'), connectBtn: $('#connect-btn'), controllerIo: $('#controller-io'), runBtn: $('#run-btn'), resetBtn: $('#reset-btn'),
  sceneCanvas: $('#scene-canvas'), telemetryCanvas: $('#telemetry-canvas'), sceneMachineName: $('#scene-machine-name'), sceneObjective: $('#scene-objective'), runStateDot: $('#run-state-dot'), runStateLabel: $('#run-state-label'), runClock: $('#run-clock'), truthPosition: $('#truth-position'), controllerState: $('#controller-state'), faultBanner: $('#fault-banner'), faultBannerText: $('#fault-banner-text'), metricSafety: $('#metric-safety'), metricError: $('#metric-error'), metricContextLabel: $('#metric-context-label'), metricContext: $('#metric-context'), metricContextNote: $('#metric-context-note'), metricBattery: $('#metric-battery'), meterSafety: $('#meter-safety'), meterError: $('#meter-error'), meterContext: $('#meter-context'), meterBattery: $('#meter-battery'), metricSafetyNote: $('#metric-safety-note'), eventList: $('#event-list'), runtimeTrace: $('#runtime-trace'),
  evidenceBtn: $('#evidence-btn'), guidedDemoBtn: $('#guided-demo-btn'), guidedRunBtn: $('#guided-run-btn'), reportDialog: $('#report-dialog'), reportContent: $('#report-content'), toast: $('#toast'), replayInput: $('#replay-input')
};

function profile() { return state.profiles[state.profileId]; }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.remove('show'), 3000);
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  const final = keys.pop();
  const target = keys.reduce((current, key) => current[key] ??= {}, object);
  target[final] = value;
}

function parseInput(input) {
  if (input.type === 'number') return input.value === '' ? null : Number(input.value);
  if (input.type === 'checkbox') return input.checked;
  if (input.dataset.manifest === 'physical.centerOfMass') return input.value.split(',').map((part) => Number(part.trim()) || 0).slice(0, 3);
  return input.value;
}

function syncProfile() {
  state.manifest = normalizeMachineManifest(state.manifest);
  const updated = profileFromManifest(state.manifest);
  const previous = state.profiles[state.profileId];
  updated.accent = previous?.accent || '#5eead4';
  updated.target = previous?.target || updated.target;
  updated.initial = previous?.initial || updated.initial;
  state.profileId = updated.id;
  state.profiles[updated.id] = updated;
  state.validation = validateMachineManifest(state.manifest);
  dom.projectName.textContent = `${state.manifest.name} Resilience Test`;
}

function selectPreset(id) {
  if (!MACHINE_PROFILES[id]) return;
  state.profileId = id;
  state.profiles[id] = clone(MACHINE_PROFILES[id]);
  state.manifest = clone(MACHINE_PROFILES[id].manifest);
  state.scenario = cloneScenario(PRESET_SCENARIOS[id][0]);
  state.selectedTestIds = clone(state.scenario.selectedTestIds || []);
  state.environment = clone(ENVIRONMENTS.find((item) => item.id === state.scenario.environmentId) || ENVIRONMENTS[0]);
  syncProfile();
  renderMachine();
  renderScenario();
  resetEngine();
  toast(`${profile().name} reference package loaded.`);
}

function newMachine() {
  state.manifest = createStarterManifest({ id: `custom-${Date.now().toString().slice(-6)}`, name: 'New custom machine', family: 'aerial', geometry: { format: 'unassigned', fileName: null, links: [], joints: [], confirmed: false }, physical: { totalMassKg: null, confirmed: false }, components: [], connections: [], capabilities: [], faults: [] });
  syncProfile();
  state.selectedTestIds = ['gnss-loss', 'command-link-loss'];
  rebuildScenario();
  renderMachine();
  toast('Blank machine manifest created. Import files or enter engineering values.');
}

function renderMachine() {
  syncProfile();
  dom.presetList.innerHTML = Object.values(MACHINE_PROFILES).map((item) => `<button class="preset-card ${item.id === state.profileId ? 'active' : ''}" data-preset="${item.id}" style="--preset-accent:${item.accent}"><i></i><span>${escapeHtml(item.family.toUpperCase())}</span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.format)}</small></button>`).join('');
  $$('[data-manifest]').forEach((input) => {
    const value = getPath(state.manifest, input.dataset.manifest);
    input.value = Array.isArray(value) ? value.join(', ') : value ?? '';
  });
  dom.physicsConfirmed.checked = Boolean(state.manifest.geometry.confirmed && state.manifest.physical.confirmed);
  dom.sourceFiles.innerHTML = (state.manifest.sourceFiles || []).map((file) => `<span class="source-file">${escapeHtml(file.name)} / ${Math.max(1, Math.round((file.size || 0) / 1024))} KB</span>`).join('');
  dom.importNotices.innerHTML = state.importNotices.map((notice) => `<span class="notice ${notice.severity}">${escapeHtml(notice.message)}${notice.sourceUrl ? ` <a href="${escapeHtml(notice.sourceUrl)}" target="_blank" rel="noreferrer">source</a>` : ''}</span>`).join('');
  const links = state.manifest.geometry.links || [];
  const joints = state.manifest.geometry.joints || [];
  dom.geometrySummary.innerHTML = `<span>${links.length} link${links.length === 1 ? '' : 's'}</span><span>${joints.length} joint${joints.length === 1 ? '' : 's'}</span><span>${escapeHtml(state.manifest.geometry.collision || links[0]?.collision || 'collision pending')}</span><span>${state.manifest.geometry.confirmed ? 'geometry confirmed' : 'confirmation required'}</span>`;
  renderComponents();
  renderConnections();
  renderReadiness();
}

function renderComponents() {
  dom.componentRows.innerHTML = state.manifest.components.map((component, index) => `<tr data-component-row="${index}">
    <td><input data-component-field="id" value="${escapeHtml(component.id)}"></td>
    <td><input data-component-field="name" value="${escapeHtml(component.name || '')}" placeholder="Part name"></td>
    <td><select data-component-field="kind">${['controller','power-source','regulator','sensor','actuator','actuator-controller','module'].map((kind) => `<option ${component.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></td>
    <td><input type="number" step=".01" data-component-field="input.minVoltage" value="${component.input?.minVoltage ?? ''}"></td>
    <td><input type="number" step=".01" data-component-field="input.maxVoltage" value="${component.input?.maxVoltage ?? ''}"></td>
    <td><input type="number" step=".01" data-component-field="input.currentA" value="${component.input?.currentA ?? ''}"></td>
    <td><input data-component-field="busAddress" value="${escapeHtml([component.bus, component.address].filter(Boolean).join(' / '))}" placeholder="i2c / 0x68"></td>
    <td><input type="checkbox" data-component-field="confirmed" ${component.confirmed === false ? '' : 'checked'}></td>
    <td><button class="icon-button remove-row" data-remove-component="${index}">x</button></td>
  </tr>`).join('') || '<tr><td colspan="9"><span class="helper">No electronics have been declared yet.</span></td></tr>';
}

function renderConnections() {
  dom.connectionRows.innerHTML = state.manifest.connections.map((connection, index) => `<tr data-connection-row="${index}">
    <td><select data-connection-field="kind">${['power','ground','signal'].map((kind) => `<option ${connection.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></td>
    <td><input data-connection-field="from" value="${escapeHtml(`${connection.from?.component || ''}.${connection.from?.pin || ''}`)}"></td>
    <td><input data-connection-field="to" value="${escapeHtml(`${connection.to?.component || ''}.${connection.to?.pin || ''}`)}"></td>
    <td><input data-connection-field="signal" value="${escapeHtml(connection.signal || '')}" placeholder="pwm / uart / i2c"></td>
    <td><input type="number" data-connection-field="frequencyHz" value="${connection.frequencyHz ?? ''}"></td>
    <td><button class="icon-button remove-row" data-remove-connection="${index}">x</button></td>
  </tr>`).join('') || '<tr><td colspan="6"><span class="helper">No power or signal connections have been declared yet.</span></td></tr>';
}

function renderReadiness() {
  state.validation = validateMachineManifest(state.manifest);
  const { blockers, warnings, checks, components, connections } = state.validation.summary;
  const score = clamp(100 - blockers * 16 - warnings * 4, 0, 100);
  dom.readinessScore.textContent = score;
  dom.readinessRing.style.setProperty('--score', `${score}%`);
  dom.readinessTitle.textContent = blockers ? 'Action required' : warnings ? 'Ready with warnings' : 'Ready to test';
  dom.readinessCounts.innerHTML = `<span><b>${blockers}</b>BLOCKERS</span><span><b>${warnings}</b>WARNINGS</span><span><b>${checks}</b>CHECK GROUPS</span><span><b>${components}</b>COMPONENTS</span><span><b>${connections}</b>WIRES</span><span><b>${state.validation.summary.powerDemandA}</b>LOAD A</span>`;
  const visible = state.validation.issues.slice(0, 18);
  dom.readinessIssues.innerHTML = visible.length ? visible.map((item) => `<article class="issue ${item.severity}"><i></i><div><b>${escapeHtml(item.code.replaceAll('_', ' '))}</b><small>${escapeHtml(item.message)}</small></div></article>`).join('') : '<article class="issue"><i style="background:var(--green)"></i><div><b>ALL DECLARED CHECKS PASS</b><small>The manifest is ready for this prototype executor.</small></div></article>';
}

async function handleMachineFiles(files) {
  if (!files?.length) return;
  dom.runtimeHealth.textContent = 'Importing machine files...';
  const result = await importMachineFiles(files, state.manifest);
  state.manifest = result.manifest;
  state.importNotices = result.notices;
  syncProfile();
  renderMachine();
  renderScenario();
  dom.runtimeHealth.textContent = 'Runtime healthy';
  toast(`${files.length} source file${files.length === 1 ? '' : 's'} processed.`);
}

function addComponent() {
  const index = state.manifest.components.length + 1;
  state.manifest.components.push({ id: `component-${index}`, name: 'New component', kind: 'module', confirmed: false, input: { minVoltage: 4.75, maxVoltage: 5.25, currentA: .1 }, pins: [{ id: 'VCC', name: 'VCC', mode: 'power' }, { id: 'GND', name: 'GND', mode: 'ground' }, { id: 'SIG', name: 'SIG', mode: 'signal' }] });
  syncProfile(); renderComponents(); renderReadiness();
}

async function lookupComponent() {
  const queryInput = $('#component-query');
  const button = $('#component-lookup-btn');
  const query = queryInput.value.trim();
  if (query.length < 3) { toast('Enter a component name or part number.'); return; }
  button.disabled = true; button.textContent = 'Researching...';
  try {
    const response = await fetch('/api/ai/component', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Component lookup failed.');
    const component = payload.component;
    const baseId = component.id || `component-${state.manifest.components.length + 1}`;
    let id = baseId; let suffix = 2;
    while (state.manifest.components.some((item) => item.id === id)) id = `${baseId}-${suffix++}`;
    component.id = id; component.confirmed = false;
    state.manifest.components.push(component);
    state.manifest.assumptions.push(`${component.name} electrical fields were drafted from ${component.sourceTitle || payload.source}; confirm against the linked manufacturer documentation before hardware use.`);
    state.importNotices.unshift({ severity: 'warning', message: `${component.name} added as an unconfirmed research draft.`, sourceUrl: component.sourceUrl || payload.citations?.[0]?.url });
    syncProfile(); renderMachine();
    queryInput.value = '';
    toast(`${component.name} added. Confirm ratings, pinout, and board-level differences.`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Find verified fields'; }
}

function addConnection() {
  const first = state.manifest.components[0]?.id || '';
  const second = state.manifest.components[1]?.id || first;
  state.manifest.connections.push({ id: `wire-${state.manifest.connections.length + 1}`, kind: 'signal', signal: 'digital', from: { component: first, pin: 'SIG' }, to: { component: second, pin: 'SIG' } });
  syncProfile(); renderConnections(); renderReadiness();
}

function availableTests() {
  const family = state.manifest.family;
  return TEST_LIBRARY.map((test) => ({ ...test, compatible: test.appliesTo.includes(family) }));
}

function rebuildScenario(options = {}) {
  const selected = TEST_LIBRARY.filter((test) => state.selectedTestIds.includes(test.id) && test.appliesTo.includes(state.manifest.family));
  state.selectedTestIds = selected.map((test) => test.id);
  state.scenario = scenarioFromTests(profile(), selected, { environmentId: state.environment.id, name: options.name, intent: options.intent });
}

function renderScenario() {
  renderEnvironments();
  renderTestLibrary();
  renderPlan();
}

function renderEnvironments() {
  dom.environmentGrid.innerHTML = ENVIRONMENTS.map((environment) => `<button class="environment-card ${environment.id === state.environment.id ? 'active' : ''}" data-environment="${environment.id}" style="--environment-color:${environment.color}"><span>${escapeHtml(environment.body.toUpperCase())}</span><b>${escapeHtml(environment.name)}</b><small>${escapeHtml(environment.terrain)}<br>${environment.gravity} m/s2 / ${environment.temperature} C</small></button>`).join('');
  dom.environmentEditor.innerHTML = ['gravity','airDensity','temperature','wind','visibility','latitude','longitude','elevation'].map((key) => `<label><span>${key.replace(/([A-Z])/g, ' $1')}</span><input type="number" step="any" data-environment-field="${key}" value="${state.environment[key]}"></label>`).join('');
}

function renderTestLibrary() {
  const categories = ['All', ...new Set(TEST_LIBRARY.map((test) => test.category))];
  dom.testFilters.innerHTML = categories.map((category) => `<button class="${state.testFilter === category ? 'active' : ''}" data-test-filter="${category}">${category}</button>`).join('');
  const query = state.testSearch.toLowerCase();
  const tests = availableTests().filter((test) => (state.testFilter === 'All' || test.category === state.testFilter) && (!query || `${test.name} ${test.description} ${test.category}`.toLowerCase().includes(query)));
  dom.testLibrary.innerHTML = tests.map((test) => `<label class="test-card ${state.selectedTestIds.includes(test.id) ? 'selected' : ''} ${test.compatible ? '' : 'incompatible'}"><input type="checkbox" data-test-id="${test.id}" ${state.selectedTestIds.includes(test.id) ? 'checked' : ''} ${test.compatible ? '' : 'disabled'}><div><b>${escapeHtml(test.name)}</b><small>${escapeHtml(test.description)}</small></div><em>${escapeHtml(test.category.toUpperCase())}</em></label>`).join('');
}

function renderPlan() {
  dom.planTitle.textContent = state.scenario.name;
  dom.planDuration.textContent = `${state.scenario.duration.toFixed(0)} s`;
  dom.planEnvironment.innerHTML = `<b>${escapeHtml(state.environment.name)}</b><small>${escapeHtml(state.environment.terrain)} / gravity ${state.environment.gravity} m/s2 / wind ${state.environment.wind} m/s</small>`;
  dom.planEvents.innerHTML = state.scenario.events.map((event, index) => {
    const meta = FAULT_LIBRARY[event.fault];
    return `<article class="plan-event" style="--event-color:${meta?.color || '#5eead4'}"><b>${escapeHtml(meta?.label || event.fault)}</b><small>T+${event.start.toFixed(1)} / ${event.duration.toFixed(1)} s / ${Math.round(event.severity * 100)}%</small><input type="range" min="10" max="100" value="${event.severity * 100}" data-event-severity="${index}" title="Severity"></article>`;
  }).join('') || '<p class="helper">Select at least one compatible test.</p>';
}

function selectEnvironment(id) {
  const environment = ENVIRONMENTS.find((item) => item.id === id);
  if (!environment) return;
  state.environment = clone(environment);
  state.scenario.environmentId = id;
  renderEnvironments(); renderPlan();
}

function toggleTest(id, selected) {
  if (selected && !state.selectedTestIds.includes(id)) state.selectedTestIds.push(id);
  if (!selected) state.selectedTestIds = state.selectedTestIds.filter((testId) => testId !== id);
  rebuildScenario();
  renderTestLibrary(); renderPlan();
}

async function generateScenario() {
  const prompt = dom.aiPrompt.value.trim();
  if (prompt.length < 8) { toast('Describe the mission risk in at least eight characters.'); return; }
  dom.generateBtn.disabled = true;
  dom.generateBtn.textContent = 'Planning executable sequence...';
  try {
    const response = await fetch('/api/ai/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, profile: profile(), environment: state.environment }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Scenario planning failed.');
    state.scenario = payload.scenario;
    state.scenario.environmentId = state.environment.id;
    state.scenario.events = state.scenario.events.map((event) => ({ ...event, testId: TEST_LIBRARY.find((test) => test.fault === event.fault)?.id || event.testId }));
    state.selectedTestIds = [...new Set(state.scenario.events.map((event) => event.testId).filter(Boolean))];
    state.scenario.selectedTestIds = clone(state.selectedTestIds);
    dom.aiMode.textContent = payload.source === 'openai' ? 'GPT-5.6 LIVE' : 'LOCAL PLANNER';
    dom.aiHelper.textContent = payload.source === 'openai' ? 'GPT-5.6 returned a schema-valid plan; the deterministic runtime will execute it.' : 'No API key was configured, so the transparent local planner produced this runnable plan.';
    renderTestLibrary(); renderPlan();
    toast(`Scenario ready: ${state.scenario.name}`);
  } catch (error) { toast(error.message); }
  finally { dom.generateBtn.disabled = false; dom.generateBtn.textContent = 'Generate executable plan'; }
}

async function checkAiStatus() {
  try {
    const response = await fetch('/api/ai/status');
    const payload = await response.json();
    state.aiConfigured = payload.configured;
    dom.aiMode.textContent = payload.configured ? 'GPT-5.6 LIVE' : 'LOCAL PLANNER';
  } catch { dom.aiMode.textContent = 'LOCAL PLANNER'; }
}

function goPage(page, options = {}) {
  if (page !== 'machine' && !state.validation.ready) {
    toast(`${state.validation.summary.blockers} readiness blocker${state.validation.summary.blockers === 1 ? '' : 's'} must be resolved first.`);
    state.page = 'machine';
  } else if (page === 'run' && state.scenario.events.length === 0) {
    toast('Select at least one compatible test before running.');
    state.page = 'scenario';
  } else state.page = page;
  $$('[data-page-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.pagePanel === state.page));
  $$('.workflow-nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === state.page);
    const order = { machine: 0, scenario: 1, run: 2 };
    button.classList.toggle('complete', order[button.dataset.page] < order[state.page]);
  });
  if (state.page === 'scenario') renderScenario();
  if (state.page === 'run') { if (!options.keepEngine) resetEngine(); renderRunConfiguration(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetEngine() {
  state.running = false;
  state.guided = false;
  const seed = Number(dom.seedInput.value) || 42;
  state.speed = Number(dom.speedSelect.value) || 1.75;
  state.scenario.environmentId = state.environment.id;
  state.scenario.selectedTestIds = clone(state.selectedTestIds);
  state.engine = new VidyutEngine(profile(), state.scenario, { seed, mode: state.mode, environment: state.environment, manifest: state.manifest, readiness: state.validation, adapter: state.mode === 'HIL' ? (hil.synthetic ? 'synthetic-web-serial' : 'web-serial') : 'deterministic-sil' });
  state.evidence = null;
  dom.runBtn.textContent = 'Run test plan';
  updateUI(state.engine.snapshot());
}

function renderRunConfiguration() {
  dom.runMachineCard.innerHTML = `<b>${escapeHtml(profile().name)}</b><small>${escapeHtml(profile().family)} / ${state.manifest.components.length} components / ${state.manifest.connections.length} connections</small>`;
  dom.runEnvironmentCard.innerHTML = `<b>${escapeHtml(state.environment.name)}</b><small>${escapeHtml(state.environment.body)} / ${state.environment.gravity} m/s2 / ${state.scenario.events.length} fault events</small>`;
  dom.sceneMachineName.textContent = profile().name;
  dom.sceneObjective.textContent = profile().objective;
  const family = state.manifest.family;
  dom.metricContextLabel.textContent = family === 'legged' ? 'Joint load' : family === 'ground' ? 'Perception' : 'Attitude';
  dom.metricContextNote.textContent = family === 'legged' ? 'Peak limit 92%' : family === 'ground' ? 'Minimum 25%' : 'Peak limit 28 deg';
  renderEventList();
}

function toggleRun() {
  if (state.engine.state.completed) resetEngine();
  state.running = !state.running;
  dom.runBtn.textContent = state.running ? 'Pause run' : 'Resume run';
  state.lastFrame = performance.now();
}

function setMode(mode) {
  state.mode = mode;
  $$('.segmented button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  if (mode === 'SIL') {
    dom.connectorTitle.textContent = 'Controller emulated';
    dom.connectorDetail.textContent = 'Deterministic SIL adapter active';
  } else {
    dom.connectorTitle.textContent = hil.connected ? 'Controller connected' : 'Controller bridge ready';
    dom.connectorDetail.textContent = hil.connected ? (hil.synthetic ? 'Synthetic bench-safe bridge' : 'Web Serial / vidyut.hil.v1') : 'Connect at 115200 baud';
  }
  resetEngine();
}

async function connectController() {
  if (state.mode !== 'HIL') setMode('HIL');
  try {
    await hil.connect({ baudRate: state.manifest.interfaces?.[0]?.baudRate || 115200 });
    dom.connectorTitle.textContent = hil.synthetic ? 'Synthetic controller connected' : 'Real controller connected';
    dom.connectorDetail.textContent = hil.synthetic ? 'Browser lacks Web Serial; safe demo loop active' : 'Bidirectional sensor / actuator JSON';
    resetEngine();
  } catch (error) { if (error.name !== 'NotFoundError') toast(`Controller connection failed: ${error.message}`); }
}

async function runSignalCheck() {
  try {
    if (!hil.connected) await hil.connect({ baudRate: state.manifest.interfaces?.[0]?.baudRate || 115200 });
    await hil.signalCheck();
    toast('Bench-safe logical signal check sent. Physical outputs remain disabled.');
  } catch (error) { if (error.name !== 'NotFoundError') toast(error.message); }
}

function renderEventList(snapshot = state.engine?.snapshot()) {
  const t = snapshot?.t || 0;
  dom.eventList.innerHTML = state.scenario.events.map((event) => {
    const meta = FAULT_LIBRARY[event.fault];
    const active = t >= event.start && t <= event.start + event.duration;
    const progress = clamp((t - event.start) / event.duration, 0, 1) * 100;
    return `<article class="event-item ${active ? 'active' : ''}" style="--event-color:${meta?.color || '#5eead4'}"><b>${escapeHtml(meta?.label || event.fault)}</b><small>T+${event.start.toFixed(1)} / ${Math.round(event.severity * 100)}% / ${event.duration.toFixed(1)} s</small><span class="event-progress"><i style="width:${progress}%"></i></span></article>`;
  }).join('');
}

function setMeter(element, value, goodHigh = true) {
  const percentage = clamp(value, 0, 100);
  element.style.width = `${percentage}%`;
  const danger = goodHigh ? percentage < 30 : percentage > 75;
  const caution = goodHigh ? percentage < 60 : percentage > 45;
  element.style.background = danger ? 'var(--red)' : caution ? 'var(--amber)' : 'var(--teal)';
}

function updateUI(snapshot) {
  const minutes = Math.floor(snapshot.t / 60);
  dom.runClock.textContent = `${String(minutes).padStart(2, '0')}:${(snapshot.t % 60).toFixed(1).padStart(4, '0')}`;
  dom.runStateLabel.textContent = snapshot.phase;
  dom.runStateDot.className = snapshot.activeFaults.length ? 'fault' : state.running ? 'running' : '';
  dom.truthPosition.textContent = `X ${snapshot.x.toFixed(1)} / Y ${snapshot.y.toFixed(1)}`;
  dom.controllerState.textContent = snapshot.controller;
  dom.faultBanner.hidden = snapshot.activeFaults.length === 0;
  dom.faultBannerText.textContent = snapshot.activeFaults.map((event) => FAULT_LIBRARY[event.fault]?.short || event.fault).join(' + ');
  const safety = clamp(snapshot.stability, 0, 100);
  const error = Math.hypot(snapshot.observedX - snapshot.x, snapshot.observedY - snapshot.y);
  dom.metricSafety.textContent = `${safety.toFixed(0)}%`;
  dom.metricSafetyNote.textContent = safety < 38 ? 'Fallback required' : safety < 65 ? 'Degraded envelope' : 'Inside envelope';
  dom.metricError.textContent = `${error.toFixed(1)} m`;
  dom.metricBattery.textContent = `${snapshot.battery.toFixed(0)}%`;
  setMeter(dom.meterSafety, safety, true); setMeter(dom.meterError, error / 18 * 100, false); setMeter(dom.meterBattery, snapshot.battery, true);
  if (state.manifest.family === 'legged') { dom.metricContext.textContent = `${snapshot.jointLoad.toFixed(0)}%`; setMeter(dom.meterContext, snapshot.jointLoad, false); }
  else if (state.manifest.family === 'ground') { dom.metricContext.textContent = `${snapshot.perception.toFixed(0)}%`; setMeter(dom.meterContext, snapshot.perception, true); }
  else { dom.metricContext.textContent = `${snapshot.attitude.toFixed(1)} deg`; setMeter(dom.meterContext, snapshot.attitude / 35 * 100, false); }
  renderEventList(snapshot);
  dom.runtimeTrace.innerHTML = snapshot.logs.slice(-12).reverse().map((entry) => `<div class="trace-entry ${entry.level}"><time>${entry.t.toFixed(1)}s</time><span>${escapeHtml(entry.text)}</span></div>`).join('');
  if (state.page === 'run') { drawScene(snapshot); drawTelemetry(snapshot.telemetry); }
  if (snapshot.completed && !state.evidence) { state.evidence = snapshot.result; state.running = false; dom.runBtn.textContent = 'Run again'; toast('Test plan complete. Open Evidence for individual test results.'); }
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function drawScene(snapshot) {
  const { context: ctx, width, height } = resizeCanvas(dom.sceneCanvas);
  ctx.clearRect(0, 0, width, height);
  const map = { left: 26, top: 22, width: width - 52, height: height - 44 };
  const px = (x) => map.left + x / 100 * map.width;
  const py = (y) => map.top + y / 100 * map.height;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#102b38'); gradient.addColorStop(1, '#07141c'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(126,166,176,.08)'; ctx.lineWidth = 1;
  for (let x = map.left; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, map.top); ctx.lineTo(x, height - map.top); ctx.stroke(); }
  for (let y = map.top; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(map.left, y); ctx.lineTo(width - map.left, y); ctx.stroke(); }
  drawEnvironment(ctx, map, px, py);
  ctx.save(); ctx.setLineDash([5,5]); ctx.strokeStyle = 'rgba(96,165,250,.55)'; ctx.beginPath(); ctx.moveTo(px(profile().initial.x), py(profile().initial.y)); ctx.lineTo(px(profile().target.x), py(profile().target.y)); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = state.environment.color; ctx.beginPath(); ctx.arc(px(profile().target.x), py(profile().target.y), 11, 0, Math.PI * 2); ctx.stroke();
  if (snapshot.telemetry.length > 1) { ctx.strokeStyle = profile().accent; ctx.globalAlpha = .45; ctx.lineWidth = 2; ctx.beginPath(); snapshot.telemetry.forEach((point, index) => index ? ctx.lineTo(px(point.x), py(point.y)) : ctx.moveTo(px(point.x), py(point.y))); ctx.stroke(); ctx.globalAlpha = 1; }
  const gap = Math.hypot(snapshot.observedX - snapshot.x, snapshot.observedY - snapshot.y);
  if (gap > .15) { ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle = '#f7b955'; ctx.beginPath(); ctx.moveTo(px(snapshot.x), py(snapshot.y)); ctx.lineTo(px(snapshot.observedX), py(snapshot.observedY)); ctx.stroke(); ctx.beginPath(); ctx.arc(px(snapshot.observedX), py(snapshot.observedY), 7, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  drawMachine(ctx, px(snapshot.x), py(snapshot.y), snapshot);
}

function drawEnvironment(ctx, map, px, py) {
  const id = state.environment.id;
  if (id === 'himalayan') {
    for (let layer = 0; layer < 3; layer += 1) { ctx.beginPath(); ctx.moveTo(map.left, map.top + map.height); for (let x = 0; x <= 100; x += 8) ctx.lineTo(px(x), py(35 + layer * 14 + Math.sin(x * .15 + layer) * 15)); ctx.lineTo(map.left + map.width, map.top + map.height); ctx.closePath(); ctx.fillStyle = `rgba(${35 + layer*13},${67 + layer*15},${76 + layer*18},${.33 + layer*.12})`; ctx.fill(); }
  } else if (id === 'urban-canyon') {
    for (let index = 0; index < 12; index += 1) { const x = 4 + index * 8; const h = 13 + (index * 17 % 32); ctx.fillStyle = 'rgba(95,118,128,.18)'; ctx.fillRect(px(x), py(50 - h / 2), map.width * .05, map.height * h / 100); }
  } else if (state.environment.body !== 'Earth') {
    for (let index = 0; index < 14; index += 1) { const x = (index * 37) % 100, y = (index * 61) % 100, r = 3 + index % 6; ctx.strokeStyle = 'rgba(203,213,225,.18)'; ctx.beginPath(); ctx.ellipse(px(x), py(y), r * 2, r, 0, 0, Math.PI * 2); ctx.stroke(); }
  } else {
    ctx.fillStyle = `${state.environment.color}18`; ctx.fillRect(map.left, map.top + map.height * .58, map.width, map.height * .42);
  }
}

function drawMachine(ctx, x, y, snapshot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(snapshot.heading * Math.PI / 180); ctx.strokeStyle = profile().accent; ctx.fillStyle = '#08161f'; ctx.lineWidth = 2; ctx.shadowBlur = 16; ctx.shadowColor = profile().accent;
  const family = state.manifest.family;
  if (family === 'aerial') { ctx.beginPath(); ctx.moveTo(-16,-16); ctx.lineTo(16,16); ctx.moveTo(16,-16); ctx.lineTo(-16,16); ctx.stroke(); [[-17,-17],[17,-17],[-17,17],[17,17]].forEach(([a,b]) => { ctx.beginPath(); ctx.arc(a,b,6,0,Math.PI*2); ctx.stroke(); }); ctx.fillRect(-7,-7,14,14); }
  else if (family === 'ground') { ctx.fillRect(-16,-10,32,20); ctx.strokeRect(-16,-10,32,20); [[-13,-13],[8,-13],[-13,11],[8,11]].forEach(([a,b]) => ctx.fillRect(a,b,7,3)); }
  else if (family === 'legged') { ctx.rotate(-snapshot.heading * Math.PI / 180); const gait = Math.sin(snapshot.t * 6) * 4; ctx.beginPath(); ctx.arc(0,-15,5,0,Math.PI*2); ctx.moveTo(0,-10); ctx.lineTo(0,4); ctx.moveTo(0,-5); ctx.lineTo(-10,gait); ctx.moveTo(0,-5); ctx.lineTo(10,-gait); ctx.moveTo(0,4); ctx.lineTo(-7,18+gait*.3); ctx.moveTo(0,4); ctx.lineTo(7,18-gait*.3); ctx.stroke(); }
  else { ctx.strokeRect(-13,-13,26,26); ctx.beginPath(); ctx.moveTo(-38,0); ctx.lineTo(-14,0); ctx.moveTo(14,0); ctx.lineTo(38,0); ctx.stroke(); ctx.strokeRect(-38,-10,22,20); ctx.strokeRect(16,-10,22,20); }
  ctx.restore();
}

function drawTelemetry(data) {
  const { context: ctx, width, height } = resizeCanvas(dom.telemetryCanvas);
  ctx.clearRect(0, 0, width, height);
  const left = 26, top = 6, bottom = 17, w = width - 35, h = height - top - bottom;
  ctx.strokeStyle = 'rgba(126,166,176,.09)'; ctx.font = '7px ui-monospace'; ctx.fillStyle = '#55727c';
  [0,50,100].forEach((value) => { const y = top + h - value/100*h; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(left+w,y); ctx.stroke(); ctx.fillText(String(value), 2, y+3); });
  if (data.length < 2) return;
  const maxT = Math.max(state.scenario.duration, data.at(-1).t); const x = (t) => left + t/maxT*w;
  const plot = (color, fn) => { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); data.forEach((point,index) => { const y = top + h - clamp(fn(point),0,100)/100*h; index ? ctx.lineTo(x(point.t),y) : ctx.moveTo(x(point.t),y); }); ctx.stroke(); };
  plot('#5eead4', (point) => point.stability); plot('#60a5fa', (point) => point.battery); plot('#f7b955', (point) => point.targetDistance * 2);
}

function openEvidence() {
  if (!state.engine) resetEngine();
  const report = state.engine.result || state.engine.buildReport();
  const metrics = report.metrics;
  const findings = report.overallAssessment === 'COMPLETE_WITH_FINDINGS';
  dom.reportContent.innerHTML = `<section class="report-hero"><div class="assessment ${findings ? 'findings' : ''}">${escapeHtml(report.overallAssessment.replaceAll('_',' '))}</div><div><h3>${escapeHtml(report.machine.name)} / ${escapeHtml(report.scenario.name)}</h3><p>${escapeHtml(report.note)}</p><span class="report-id">${escapeHtml(report.runId)} / ${report.mode} / seed ${report.deterministicSeed} / ${escapeHtml(report.machineManifestFingerprint || 'no manifest fingerprint')}</span></div></section>
    <section class="report-metrics"><article><span>FINAL DISTANCE</span><b>${metrics.finalDistance} m</b></article><article><span>PEAK ESTIMATE ERROR</span><b>${metrics.peakEstimateError} m</b></article><article><span>MIN SAFETY</span><b>${metrics.minimumSafetyMargin}%</b></article><article><span>FINAL BATTERY</span><b>${metrics.finalBattery}%</b></article></section>
    <section><span class="eyebrow">INDIVIDUAL TEST CASE RESULTS</span>${report.testCases.map((test) => `<article class="test-result"><span class="test-status ${test.status.toLowerCase().replace('_','-')}">${escapeHtml(test.status)}</span><div><b>${escapeHtml(test.name)}</b><small>${escapeHtml(test.assertion)}</small><small>${escapeHtml(test.evidence)}</small></div></article>`).join('') || '<p class="helper">Run the configured plan to evaluate test cases.</p>'}</section>`;
  dom.reportDialog.showModal();
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadManifest() { download(`${state.manifest.id}.vidyut.json`, JSON.stringify(state.manifest, null, 2), 'application/json'); }
function downloadReport() { const report = state.engine.result || state.engine.buildReport(); download(`${report.runId}.json`, JSON.stringify(report, null, 2), 'application/json'); }
function downloadCsv() { const data = state.engine.telemetry; if (!data.length) { toast('Run the plan before exporting telemetry.'); return; } const headers = ['t','x','y','targetDistance','stability','battery','perception','link','attitude','jointLoad','latencyMs','computeLoad','packetDelivery','controller','faults']; const rows = data.map((row) => headers.map((key) => `"${String(Array.isArray(row[key]) ? row[key].join('|') : row[key] ?? '').replaceAll('"','""')}"`).join(',')); download(`vidyut-${state.profileId}-telemetry.csv`, [headers.join(','), ...rows].join('\n'), 'text/csv'); }

async function loadReplay(file) {
  try {
    const evidence = JSON.parse(await file.text());
    if (!evidence.replay?.scenario) throw new Error('This file does not contain a VIDYUT replay configuration.');
    if (state.profiles[evidence.replay.profileId]) state.profileId = evidence.replay.profileId;
    state.manifest = clone(profile().manifest);
    state.scenario = clone(evidence.replay.scenario);
    state.selectedTestIds = clone(state.scenario.selectedTestIds || []);
    state.environment = clone(evidence.replay.environment || ENVIRONMENTS[0]);
    dom.seedInput.value = evidence.replay.seed || 42;
    state.mode = evidence.replay.mode || 'SIL';
    syncProfile(); goPage('run');
    dom.reportDialog.close(); toast('Replay configuration loaded. Run it to reproduce the evidence path.');
  } catch (error) { toast(error.message); }
}

function startGuidedDemo() {
  selectPreset('drone');
  dom.seedInput.value = 42; dom.speedSelect.value = 3; state.speed = 3; state.guided = true;
  goPage('run'); state.running = true; state.lastFrame = performance.now(); dom.runBtn.textContent = 'Pause run';
  toast('Judge path started: drone / Himalayan range / GNSS + link + wind.');
}

function animationLoop(now) {
  const elapsed = Math.min((now - state.lastFrame) / 1000, .1); state.lastFrame = now;
  if (state.running && state.engine && !state.engine.state.completed) {
    const step = elapsed * state.speed;
    state.engine.step(step, state.hardwareSample, state.actuatorCommand);
    const snapshot = state.engine.snapshot();
    if (state.mode === 'HIL' && hil.connected) hil.publishSensorFrame(snapshot, state.environment, snapshot.activeFaults).catch(() => {});
    updateUI(snapshot);
  } else if (state.engine && state.page === 'run') { drawScene(state.engine.snapshot()); drawTelemetry(state.engine.telemetry); }
  requestAnimationFrame(animationLoop);
}

function bindEvents() {
  $('.workflow-nav').addEventListener('click', (event) => { const button = event.target.closest('[data-page]'); if (button) goPage(button.dataset.page); });
  $$('[data-go-page]').forEach((button) => button.addEventListener('click', () => goPage(button.dataset.goPage)));
  dom.presetList.addEventListener('click', (event) => { const button = event.target.closest('[data-preset]'); if (button) selectPreset(button.dataset.preset); });
  $('#new-machine-btn').addEventListener('click', newMachine);
  $('#download-manifest-btn').addEventListener('click', downloadManifest);
  $('#machine-next-btn').addEventListener('click', () => goPage('scenario'));
  $('#scenario-next-btn').addEventListener('click', () => goPage('run'));
  dom.machineFiles.addEventListener('change', () => handleMachineFiles(dom.machineFiles.files));
  ['dragenter','dragover'].forEach((name) => dom.dropzone.addEventListener(name, (event) => { event.preventDefault(); dom.dropzone.classList.add('dragging'); }));
  ['dragleave','drop'].forEach((name) => dom.dropzone.addEventListener(name, (event) => { event.preventDefault(); dom.dropzone.classList.remove('dragging'); if (name === 'drop') handleMachineFiles(event.dataTransfer.files); }));
  $('#page-machine').addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.manifest) { setPath(state.manifest, input.dataset.manifest, parseInput(input)); syncProfile(); renderReadiness(); }
    if (input.dataset.componentField) {
      const component = state.manifest.components[Number(input.closest('[data-component-row]').dataset.componentRow)];
      if (input.dataset.componentField === 'busAddress') { const [bus, address] = input.value.split('/').map((value) => value.trim()); component.bus = bus || null; component.address = address || null; }
      else setPath(component, input.dataset.componentField, parseInput(input));
      syncProfile(); renderReadiness();
    }
    if (input.dataset.connectionField) {
      const connection = state.manifest.connections[Number(input.closest('[data-connection-row]').dataset.connectionRow)];
      if (['from','to'].includes(input.dataset.connectionField)) { const dot = input.value.indexOf('.'); connection[input.dataset.connectionField] = { component: dot < 0 ? input.value : input.value.slice(0,dot), pin: dot < 0 ? '' : input.value.slice(dot+1) }; }
      else connection[input.dataset.connectionField] = parseInput(input);
      syncProfile(); renderReadiness();
    }
  });
  dom.physicsConfirmed.addEventListener('change', () => { state.manifest.geometry.confirmed = dom.physicsConfirmed.checked; state.manifest.physical.confirmed = dom.physicsConfirmed.checked; syncProfile(); renderReadiness(); });
  $('#add-component-btn').addEventListener('click', addComponent); $('#add-connection-btn').addEventListener('click', addConnection);
  $('#component-lookup-btn').addEventListener('click', lookupComponent);
  $('#page-machine').addEventListener('click', (event) => {
    const component = event.target.closest('[data-remove-component]'); if (component) { state.manifest.components.splice(Number(component.dataset.removeComponent), 1); syncProfile(); renderComponents(); renderReadiness(); }
    const connection = event.target.closest('[data-remove-connection]'); if (connection) { state.manifest.connections.splice(Number(connection.dataset.removeConnection), 1); syncProfile(); renderConnections(); renderReadiness(); }
  });
  $('#signal-check-btn').addEventListener('click', runSignalCheck);
  dom.environmentGrid.addEventListener('click', (event) => { const button = event.target.closest('[data-environment]'); if (button) selectEnvironment(button.dataset.environment); });
  $('#customize-environment-btn').addEventListener('click', () => dom.environmentEditor.classList.toggle('open'));
  dom.environmentEditor.addEventListener('change', (event) => { const input = event.target.closest('[data-environment-field]'); if (!input) return; state.environment = { ...state.environment, id: 'custom', name: `Custom ${state.environment.name}`, [input.dataset.environmentField]: Number(input.value) }; state.scenario.environmentId = 'custom'; renderEnvironments(); dom.environmentEditor.classList.add('open'); renderPlan(); });
  dom.testFilters.addEventListener('click', (event) => { const button = event.target.closest('[data-test-filter]'); if (button) { state.testFilter = button.dataset.testFilter; renderTestLibrary(); } });
  dom.testSearch.addEventListener('input', () => { state.testSearch = dom.testSearch.value; renderTestLibrary(); });
  dom.testLibrary.addEventListener('change', (event) => { const input = event.target.closest('[data-test-id]'); if (input) toggleTest(input.dataset.testId, input.checked); });
  dom.planEvents.addEventListener('input', (event) => { const input = event.target.closest('[data-event-severity]'); if (!input) return; state.scenario.events[Number(input.dataset.eventSeverity)].severity = Number(input.value) / 100; renderPlan(); });
  dom.generateBtn.addEventListener('click', generateScenario);
  dom.seedInput.addEventListener('change', resetEngine); dom.speedSelect.addEventListener('change', () => state.speed = Number(dom.speedSelect.value));
  $$('.segmented button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  dom.connectBtn.addEventListener('click', connectController); $('#estop-btn').addEventListener('click', () => hil.emergencyStop()); $('#clear-estop-btn').addEventListener('click', () => hil.clearEmergencyStop());
  dom.runBtn.addEventListener('click', toggleRun); dom.resetBtn.addEventListener('click', resetEngine);
  dom.evidenceBtn.addEventListener('click', openEvidence); $('#close-report').addEventListener('click', () => dom.reportDialog.close()); $('#download-report').addEventListener('click', downloadReport); $('#download-csv').addEventListener('click', downloadCsv); dom.replayInput.addEventListener('change', () => loadReplay(dom.replayInput.files[0]));
  dom.guidedDemoBtn.addEventListener('click', startGuidedDemo); dom.guidedRunBtn.addEventListener('click', startGuidedDemo);
  hil.addEventListener('telemetry', (event) => { state.hardwareSample = event.detail; dom.controllerIo.textContent = JSON.stringify(event.detail, null, 2); });
  hil.addEventListener('actuators', (event) => { state.actuatorCommand = event.detail; dom.controllerIo.textContent = JSON.stringify(event.detail, null, 2); });
  hil.addEventListener('status', (event) => { dom.connectorDetail.textContent = event.detail.detail; toast(event.detail.detail); });
  hil.addEventListener('error', (event) => toast(event.detail.message || 'Controller bridge error.'));
  window.addEventListener('resize', () => { if (state.page === 'run' && state.engine) updateUI(state.engine.snapshot()); });
}

function init() {
  state.validation = validateMachineManifest(state.manifest);
  bindEvents();
  renderMachine(); renderScenario(); resetEngine(); renderRunConfiguration(); checkAiStatus();
  requestAnimationFrame(animationLoop);
}

init();
