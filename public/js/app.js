import { ENVIRONMENTS, FAULT_LIBRARY, TEST_LIBRARY, scenarioFromTests } from './catalog.js';
import { findCuratedComponent } from './components.js';
import { MACHINE_PROFILES, PRESET_SCENARIOS, cloneScenario, profileFromManifest } from './profiles.js';
import { createStarterManifest, importMachineFiles, normalizeMachineManifest, validateMachineManifest } from './manifest.js';
import { VidyutEngine } from './engine.js';
import { HilBridge } from './hil.js';
import { ProvingGround3D } from './three-scene.js';
import { runCoverageSweep } from './coverage.js';
import { BACKENDS, backendStatus, buildBackendPackage } from './adapters.js';
import { GripperBridge } from './gripper.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hil = new HilBridge();
const gripper = new GripperBridge();

const state = {
  page: 'machine',
  profiles: clone(MACHINE_PROFILES),
  profileId: 'drone',
  manifest: clone(MACHINE_PROFILES.drone.manifest),
  validation: null,
  environment: clone(ENVIRONMENTS[0]),
  selectedTestIds: clone(PRESET_SCENARIOS.drone[0].selectedTestIds),
  customTests: [],
  scenario: cloneScenario(PRESET_SCENARIOS.drone[0]),
  testFilter: 'All',
  testSearch: '',
  mode: 'SIL',
  backendId: 'vidyut',
  backendStatuses: null,
  engine: null,
  running: false,
  speed: 1.75,
  lastFrame: performance.now(),
  hardwareSample: null,
  actuatorCommand: null,
  aiConfigured: false,
  importNotices: [],
  evidence: null,
  guided: false,
  coverage: null
};

const dom = {
  projectName: $('#header-project-name'), runtimeHealth: $('#runtime-health'), presetList: $('#preset-list'), machineFiles: $('#machine-files'), dropzone: $('#machine-dropzone'), importNotices: $('#import-notices'), sourceFiles: $('#source-files'),
  physicsConfirmed: $('#physics-confirmed'), componentRows: $('#component-rows'), connectionRows: $('#connection-rows'), geometrySummary: $('#geometry-summary'), readinessTitle: $('#readiness-title'), readinessRing: $('#readiness-ring'), readinessScore: $('#readiness-score'), readinessCounts: $('#readiness-counts'), readinessIssues: $('#readiness-issues'),
  environmentGrid: $('#environment-grid'), environmentEditor: $('#environment-editor'), testFilters: $('#test-filters'), testSearch: $('#test-search'), testLibrary: $('#test-library'), customTestEditor: $('#custom-test-editor'), customTestName: $('#custom-test-name'), customTestFault: $('#custom-test-fault'), customTestSeverity: $('#custom-test-severity'), customTestDuration: $('#custom-test-duration'), customTestAssertion: $('#custom-test-assertion'), planTitle: $('#plan-title'), planDuration: $('#plan-duration'), planEnvironment: $('#plan-environment'), planEvents: $('#plan-events'), seedInput: $('#seed-input'), speedSelect: $('#speed-select'),
  aiPrompt: $('#ai-prompt'), aiMode: $('#ai-mode'), aiHelper: $('#ai-helper'), generateBtn: $('#generate-btn'),
  runMachineCard: $('#run-machine-card'), runEnvironmentCard: $('#run-environment-card'), backendSelect: $('#backend-select'), backendStatus: $('#backend-status'), connectorTitle: $('#connector-title'), connectorDetail: $('#connector-detail'), connectBtn: $('#connect-btn'), hilSafetyConfirm: $('#hil-safety-confirm'), controllerIo: $('#controller-io'), runBtn: $('#run-btn'), resetBtn: $('#reset-btn'),
  sceneCanvas: $('#scene-canvas'), telemetryCanvas: $('#telemetry-canvas'), cameraMode: $('#camera-mode'), sceneAltitude: $('#scene-altitude'), sceneVerticalSpeed: $('#scene-vertical-speed'), sceneMotionConstraint: $('#scene-motion-constraint'), sceneMachineName: $('#scene-machine-name'), sceneObjective: $('#scene-objective'), runStateDot: $('#run-state-dot'), runStateLabel: $('#run-state-label'), runClock: $('#run-clock'), truthPosition: $('#truth-position'), controllerState: $('#controller-state'), faultBanner: $('#fault-banner'), faultBannerText: $('#fault-banner-text'), metricSafety: $('#metric-safety'), metricError: $('#metric-error'), metricContextLabel: $('#metric-context-label'), metricContext: $('#metric-context'), metricContextNote: $('#metric-context-note'), metricBattery: $('#metric-battery'), meterSafety: $('#meter-safety'), meterError: $('#meter-error'), meterContext: $('#meter-context'), meterBattery: $('#meter-battery'), metricSafetyNote: $('#metric-safety-note'), eventList: $('#event-list'), runtimeTrace: $('#runtime-trace'),
  evidenceBtn: $('#evidence-btn'), guidedDemoBtn: $('#guided-demo-btn'), guidedRunBtn: $('#guided-run-btn'), reportDialog: $('#report-dialog'), reportContent: $('#report-content'), batchDialog: $('#batch-dialog'), batchContent: $('#batch-content'), toast: $('#toast'), replayInput: $('#replay-input')
};

Object.assign(dom, {
  gripperTwin: $('#gripper-twin'), gripperAngle: $('#gripper-angle'), gripperStatus: $('#gripper-status'), gripperConnectBtn: $('#gripper-connect-btn'), gripperSafetyConfirm: $('#gripper-safety-confirm'), gripperUnsafeBtn: $('#gripper-unsafe-btn'), gripperStopBtn: $('#gripper-stop-btn'), gripperLog: $('#gripper-log')
});

const provingGround = new ProvingGround3D(dom.sceneCanvas);

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
  state.customTests = [];
  state.selectedTestIds = clone(state.scenario.selectedTestIds || []);
  state.environment = clone(ENVIRONMENTS.find((item) => item.id === state.scenario.environmentId) || ENVIRONMENTS[0]);
  provingGround.useProceduralMachine(state.manifest.family);
  syncProfile();
  renderMachine();
  renderScenario();
  resetEngine();
  toast(`${profile().name} reference package loaded.`);
}

function newMachine() {
  state.manifest = createStarterManifest({ id: `custom-${Date.now().toString().slice(-6)}`, name: 'New custom machine', family: 'aerial', geometry: { format: 'unassigned', fileName: null, links: [], joints: [], confirmed: false }, physical: { totalMassKg: null, confirmed: false }, components: [], connections: [], capabilities: [], faults: [] });
  state.customTests = [];
  provingGround.useProceduralMachine('aerial');
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
  try {
    const geometry = await provingGround.loadUploadedGeometry(files, state.manifest.family);
    if (geometry.loaded) state.importNotices.unshift({ severity: 'info', message: `${geometry.name} loaded into the live 3D proving ground.` });
  } catch (error) {
    state.importNotices.unshift({ severity: 'warning', message: `3D preview could not load the selected glTF/GLB: ${error.message}` });
    provingGround.useProceduralMachine(state.manifest.family);
  }
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
    const local = findCuratedComponent(query);
    let payload;
    if (local) payload = { component: local, source: 'curated-browser', citations: [{ url: local.sourceUrl, title: local.sourceTitle }], requiresConfirmation: true };
    else {
      const response = await fetch('/api/ai/component', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Component lookup failed.');
    }
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

function planLocally(prompt) {
  const text = prompt.toLowerCase();
  const compatible = TEST_LIBRARY.filter((test) => test.appliesTo.includes(state.manifest.family) && test.fault !== 'multi_fault');
  const tokens = {
    gnss_drift: ['gnss','gps','navigation','position'], link_loss: ['link','radio','communication','signal'], wind_gust: ['wind','gust','weather','storm'],
    imu_bias: ['imu','inertial','balance'], motor_loss: ['motor','actuator','propeller','thrust'], battery_sag: ['battery','power','voltage','cold'],
    camera_occlusion: ['camera','vision','dark','occlusion'], obstacle_injection: ['obstacle','collision','hazard'], low_visibility: ['fog','dust','visibility','dark'],
    precipitation: ['rain','snow','precipitation'], temperature_extreme: ['temperature','heat','cold'], pressure_altitude: ['altitude','pressure','mountain'],
    emi: ['emi','interference','magnetic'], sensor_dropout: ['sensor','dropout'], actuator_stuck: ['stuck','jammed'], power_brownout: ['brownout','reset'],
    latency_jitter: ['latency','jitter','delay'], packet_loss: ['packet','bus'], cpu_overload: ['cpu','compute','overload'], memory_pressure: ['memory'],
    waypoint_reroute: ['waypoint','reroute','route'], geofence_breach: ['geofence','boundary'], wheel_slip: ['slip','mud','traction'], joint_torque_loss: ['joint','knee','torque']
  };
  const ranked = compatible.map((test) => ({ test, score: (tokens[test.fault] || []).reduce((score, token) => score + (text.includes(token) ? 3 : 0), 0) })).sort((a,b) => b.score - a.score);
  const selected = ranked.some((item) => item.score > 0) ? ranked.filter((item) => item.score > 0).slice(0, 4).map((item) => item.test) : compatible.slice(0, 3);
  state.selectedTestIds = selected.map((test) => test.id);
  state.scenario = scenarioFromTests(profile(), selected, { environmentId: state.environment.id, name: selected.map((test) => test.name).join(' + ').slice(0, 64), intent: `Stress ${profile().name} against the mission risk: ${prompt.slice(0, 180)}` });
  state.scenario.selectedTestIds = clone(state.selectedTestIds);
}

function localEnvironmentProposal(prompt) {
  const text = prompt.toLowerCase();
  const tokens = [
    [['mars', 'martian'], 'mars'], [['moon', 'lunar'], 'lunar'], [['himalaya', 'mountain', 'ridge'], 'himalayan'],
    [['desert', 'dune'], 'desert'], [['arctic', 'ice', 'polar'], 'arctic'], [['rainforest', 'jungle'], 'rainforest'], [['urban', 'city'], 'urban-canyon']
  ];
  const selectedId = tokens.find(([words]) => words.some((word) => text.includes(word)))?.[1];
  const proposal = clone(ENVIRONMENTS.find((item) => item.id === selectedId) || state.environment);
  const patterns = { gravity: /gravity\s*(?:=|of|at)?\s*(-?\d+(?:\.\d+)?)/i, airDensity: /air\s*density\s*(?:=|of|at)?\s*(-?\d+(?:\.\d+)?)/i, temperature: /temperature\s*(?:=|of|at)?\s*(-?\d+(?:\.\d+)?)/i, wind: /wind(?:\s*speed)?\s*(?:=|of|at)?\s*(\d+(?:\.\d+)?)/i, visibility: /visibility\s*(?:=|of|at)?\s*(\d+(?:\.\d+)?)/i, elevation: /(?:elevation|altitude)\s*(?:=|of|at)?\s*(-?\d+(?:\.\d+)?)/i };
  for (const [key, pattern] of Object.entries(patterns)) { const match = prompt.match(pattern); if (match) proposal[key] = Number(match[1]); }
  return { ...proposal, id: 'custom-ai', name: `AI proposal: ${proposal.name}`, version: 'proposal-v1', confirmed: false, provenance: 'Transparent local prompt parser; engineer confirmation required', rationale: 'Environment selected from a curated template and bounded numeric values extracted from the mission prompt.' };
}

function applyEnvironmentProposal(patch) {
  if (!patch) return;
  const bounds = { gravity: [0, 30], airDensity: [0, 2.5], temperature: [-200, 100], wind: [0, 100], visibility: [0, 100], latitude: [-90, 90], longitude: [-180, 180], elevation: [-12000, 100000] };
  const next = { ...state.environment };
  for (const key of ['name', 'body', 'terrain', 'rationale', 'provenance', 'version']) if (patch[key] != null) next[key] = String(patch[key]);
  for (const [key, [min, max]] of Object.entries(bounds)) if (patch[key] != null && Number.isFinite(Number(patch[key]))) next[key] = clamp(Number(patch[key]), min, max);
  state.environment = { ...next, id: 'custom-ai', confirmed: false, provenance: patch.provenance || 'GPT-5.6 environment proposal; engineer confirmation required' };
  state.scenario.environmentId = state.environment.id;
}

function addConnection() {
  const first = state.manifest.components[0]?.id || '';
  const second = state.manifest.components[1]?.id || first;
  state.manifest.connections.push({ id: `wire-${state.manifest.connections.length + 1}`, kind: 'signal', signal: 'digital', from: { component: first, pin: 'SIG' }, to: { component: second, pin: 'SIG' } });
  syncProfile(); renderConnections(); renderReadiness();
}

function availableTests() {
  const family = state.manifest.family;
  return [...TEST_LIBRARY, ...state.customTests].map((test) => ({ ...test, compatible: test.appliesTo.includes(family) }));
}

function rebuildScenario(options = {}) {
  const selected = availableTests().filter((test) => state.selectedTestIds.includes(test.id) && test.appliesTo.includes(state.manifest.family));
  state.selectedTestIds = selected.map((test) => test.id);
  state.scenario = scenarioFromTests(profile(), selected, { environmentId: state.environment.id, name: options.name, intent: options.intent });
  state.scenario.testDefinitions = clone(state.customTests.filter((test) => state.selectedTestIds.includes(test.id)));
}

function renderScenario() {
  renderEnvironments();
  renderTestLibrary();
  renderPlan();
}

function renderEnvironments() {
  dom.environmentGrid.innerHTML = ENVIRONMENTS.map((environment) => `<button class="environment-card ${environment.id === state.environment.id ? 'active' : ''}" data-environment="${environment.id}" style="--environment-color:${environment.color}"><span>${escapeHtml(environment.body.toUpperCase())}</span><b>${escapeHtml(environment.name)}</b><small>${escapeHtml(environment.terrain)}<br>${environment.gravity} m/s2 / ${environment.temperature} C</small></button>`).join('');
  dom.environmentEditor.innerHTML = `${['gravity','airDensity','temperature','wind','visibility','latitude','longitude','elevation'].map((key) => `<label><span>${key.replace(/([A-Z])/g, ' $1')}</span><input type="number" step="any" data-environment-field="${key}" value="${state.environment[key] ?? ''}"></label>`).join('')}<label class="confirm"><input type="checkbox" data-environment-confirm ${state.environment.confirmed ? 'checked' : ''}><span>Engineer confirmed environment values</span></label>`;
}

function renderTestLibrary() {
  const categories = ['All', ...new Set(availableTests().map((test) => test.category))];
  dom.testFilters.innerHTML = categories.map((category) => `<button class="${state.testFilter === category ? 'active' : ''}" data-test-filter="${category}">${category}</button>`).join('');
  const query = state.testSearch.toLowerCase();
  const tests = availableTests().filter((test) => (state.testFilter === 'All' || test.category === state.testFilter) && (!query || `${test.name} ${test.description} ${test.category}`.toLowerCase().includes(query)));
  dom.testLibrary.innerHTML = tests.map((test) => `<label class="test-card ${test.custom ? 'custom' : ''} ${state.selectedTestIds.includes(test.id) ? 'selected' : ''} ${test.compatible ? '' : 'incompatible'}"><input type="checkbox" data-test-id="${test.id}" ${state.selectedTestIds.includes(test.id) ? 'checked' : ''} ${test.compatible ? '' : 'disabled'}><div><b>${escapeHtml(test.name)}</b><small>${escapeHtml(test.description)}</small></div><em>${escapeHtml(test.category.toUpperCase())}</em></label>`).join('');
  const selectedFault = dom.customTestFault.value;
  dom.customTestFault.innerHTML = profile().faults.map((fault) => `<option value="${escapeHtml(fault)}" ${fault === selectedFault ? 'selected' : ''}>${escapeHtml(FAULT_LIBRARY[fault]?.label || fault)}</option>`).join('');
}

function addCustomTest() {
  const name = dom.customTestName.value.trim();
  const fault = dom.customTestFault.value;
  const assertion = dom.customTestAssertion.value.trim();
  if (name.length < 3 || !profile().faults.includes(fault) || assertion.length < 8) { toast('Enter a name, compatible fault hook, and measurable assertion.'); return; }
  const definition = {
    id: `custom-${Date.now().toString(36)}`,
    name: name.slice(0, 80),
    category: 'Custom',
    fault,
    appliesTo: [state.manifest.family],
    defaultSeverity: clamp(Number(dom.customTestSeverity.value) / 100 || .7, .1, 1),
    duration: clamp(Number(dom.customTestDuration.value) || 6, 1, 20),
    assertion: assertion.slice(0, 240),
    description: `Project-specific test using the validated ${FAULT_LIBRARY[fault]?.label || fault} execution hook.`,
    custom: true,
    confirmed: true
  };
  state.customTests.push(definition);
  state.selectedTestIds.push(definition.id);
  rebuildScenario({ name: `${name} validation plan`, intent: assertion });
  dom.customTestName.value = '';
  dom.customTestAssertion.value = '';
  dom.customTestEditor.classList.remove('open');
  renderTestLibrary(); renderPlan();
  toast(`${definition.name} added to this project.`);
}

function renderPlan() {
  dom.planTitle.textContent = state.scenario.name;
  dom.planDuration.textContent = `${state.scenario.duration.toFixed(0)} s`;
  dom.planEnvironment.innerHTML = `<b>${escapeHtml(state.environment.name)}</b><small>${escapeHtml(state.environment.terrain)} / gravity ${state.environment.gravity} m/s2 / wind ${state.environment.wind} m/s / ${state.environment.confirmed ? 'confirmed' : 'confirmation required'}</small>`;
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
    let payload;
    try {
      const response = await fetch('/api/ai/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, profile: profile(), environment: state.environment }) });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Scenario planning failed.');
      state.scenario = payload.scenario;
    } catch {
      planLocally(prompt);
      payload = { source: 'fallback', scenario: state.scenario, environmentPatch: localEnvironmentProposal(prompt) };
    }
    applyEnvironmentProposal(payload.environmentPatch || localEnvironmentProposal(prompt));
    state.scenario.environmentId = state.environment.id;
    state.scenario.events = state.scenario.events.map((event) => ({ ...event, testId: TEST_LIBRARY.find((test) => test.fault === event.fault)?.id || event.testId }));
    state.selectedTestIds = [...new Set(state.scenario.events.map((event) => event.testId).filter(Boolean))];
    state.scenario.selectedTestIds = clone(state.selectedTestIds);
    dom.aiMode.textContent = payload.source === 'openai' ? 'GPT-5.6 LIVE' : 'LOCAL PLANNER';
    dom.aiHelper.textContent = payload.source === 'openai' ? 'GPT-5.6 returned a schema-valid plan; the deterministic runtime will execute it.' : 'No API key was configured, so the transparent local planner produced this runnable plan.';
    renderEnvironments(); renderTestLibrary(); renderPlan();
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
  const selectedBackend = BACKENDS[state.backendId] || BACKENDS.vidyut;
  const adapter = state.mode === 'HIL' ? (hil.synthetic ? 'synthetic-web-serial' : 'web-serial') : selectedBackend.adapter;
  state.engine = new VidyutEngine(profile(), state.scenario, { seed, mode: state.mode, environment: state.environment, manifest: state.manifest, readiness: state.validation, adapter });
  if (state.backendId !== 'vidyut') state.engine.simulator = { id: selectedBackend.id, version: 'external-runtime-required', timeStepPolicy: 'adapter-defined', fidelity: selectedBackend.fidelity };
  state.evidence = null;
  dom.runBtn.textContent = 'Run test plan';
  updateUI(state.engine.snapshot());
}

function renderRunConfiguration() {
  dom.runMachineCard.innerHTML = `<b>${escapeHtml(profile().name)}</b><small>${escapeHtml(profile().family)} / ${state.manifest.components.length} components / ${state.manifest.connections.length} connections</small>`;
  dom.runEnvironmentCard.innerHTML = `<b>${escapeHtml(state.environment.name)}</b><small>${escapeHtml(state.environment.body)} / ${state.environment.gravity} m/s2 / ${state.scenario.events.length} fault events</small>`;
  dom.sceneMachineName.textContent = profile().name;
  dom.sceneObjective.textContent = profile().objective;
  dom.hilSafetyConfirm.checked = Boolean(state.manifest.safety?.benchChecklistConfirmed);
  const family = state.manifest.family;
  dom.metricContextLabel.textContent = family === 'legged' ? 'Joint load' : family === 'ground' ? 'Perception' : 'Attitude';
  dom.metricContextNote.textContent = family === 'legged' ? 'Peak limit 92%' : family === 'ground' ? 'Minimum 25%' : 'Peak limit 28 deg';
  renderEventList();
}

function toggleRun() {
  if (state.engine.state.completed) resetEngine();
  if (state.mode === 'SIL' && state.backendId !== 'vidyut' && !state.backendStatuses?.[state.backendId]?.available) {
    toast(`${BACKENDS[state.backendId].name} is not connected. Start its bridge or choose the VIDYUT preview.`);
    return;
  }
  if (!state.running && state.mode === 'HIL') {
    if (!hil.connected) { toast('Connect the HIL controller before starting the run.'); return; }
    if (hil.available && !dom.hilSafetyConfirm.checked) { toast('Confirm the bench-safety checklist before using real hardware.'); return; }
    if (!hil.ready) { toast(hil.emergencyStopped ? 'Clear the emergency stop before running.' : 'Wait for a compatible controller handshake before running.'); return; }
  }
  state.running = !state.running;
  dom.runBtn.textContent = state.running ? 'Pause run' : 'Resume run';
  state.lastFrame = performance.now();
}

function renderBackendStatus() {
  const status = state.backendStatuses?.[state.backendId] || { available: state.backendId === 'vidyut', detail: state.backendId === 'vidyut' ? 'Browser deterministic preview ready.' : 'Checking external bridge...' };
  const backend = BACKENDS[state.backendId] || BACKENDS.vidyut;
  dom.backendStatus.classList.toggle('unavailable', !status.available);
  dom.backendStatus.innerHTML = `<i></i><div><b>${escapeHtml(status.available ? `${backend.name} ready` : `${backend.name} unavailable`)}</b><small>${escapeHtml(status.detail)}</small></div>`;
}

async function refreshBackendStatus() {
  state.backendStatuses = await backendStatus();
  renderBackendStatus();
}

function selectBackend(id) {
  state.backendId = BACKENDS[id] ? id : 'vidyut';
  dom.backendSelect.value = state.backendId;
  renderBackendStatus();
  resetEngine();
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
    if (hil.connected) {
      state.running = false;
      await hil.disconnect();
      dom.connectBtn.textContent = 'Connect';
      dom.connectorTitle.textContent = 'Controller bridge ready';
      dom.connectorDetail.textContent = 'Connect at the declared baud rate';
      resetEngine();
      return;
    }
    if (hil.available && !dom.hilSafetyConfirm.checked) { toast('Confirm that the physical power stage and actuators are disabled before connecting.'); return; }
    state.manifest.safety.benchChecklistConfirmed = dom.hilSafetyConfirm.checked;
    hil.watchdogMs = Math.max(250, Number(state.manifest.safety?.watchdogMs) || 750);
    await hil.connect({ baudRate: state.manifest.interfaces?.[0]?.baudRate || 115200, requireHandshake: true });
    dom.connectorTitle.textContent = hil.synthetic ? 'Synthetic controller connected' : 'Real controller connected';
    dom.connectorDetail.textContent = hil.synthetic ? 'Browser lacks Web Serial; safe demo loop active' : `${hil.handshake.controller} / ${hil.handshake.firmware}`;
    dom.connectBtn.textContent = 'Disconnect';
    resetEngine();
  } catch (error) { if (error.name !== 'NotFoundError') toast(`Controller connection failed: ${error.message}`); }
}

async function runSignalCheck() {
  try {
    if (!hil.connected) {
      if (hil.available && !dom.hilSafetyConfirm.checked) throw new Error('Confirm the bench-safety checklist before connecting real hardware.');
      await hil.connect({ baudRate: state.manifest.interfaces?.[0]?.baudRate || 115200, requireHandshake: true });
      dom.connectBtn.textContent = 'Disconnect';
    }
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
  const family = state.manifest.family;
  const view = provingGround.update(snapshot, { environment: state.environment, profile: profile(), family });
  dom.truthPosition.textContent = `X ${snapshot.x.toFixed(1)} / Y ${snapshot.y.toFixed(1)} / Z ${snapshot.altitude.toFixed(1)} m`;
  dom.sceneAltitude.textContent = family === 'aerial' ? `${view.agl.toFixed(1)} m` : family === 'spacecraft' ? `${snapshot.altitude.toFixed(1)} km` : '0.0 m';
  dom.sceneVerticalSpeed.textContent = family === 'aerial' ? `${view.verticalSpeed >= 0 ? '+' : ''}${view.verticalSpeed.toFixed(1)} m/s` : 'SURFACE LOCK';
  dom.sceneMotionConstraint.textContent = family === 'aerial' ? '3D FLIGHT' : family === 'spacecraft' ? 'ORBITAL 3D' : family === 'legged' ? 'TERRAIN CONTACT' : 'SURFACE ONLY';
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

function runBatchCoverage() {
  if (!state.validation?.ready) { toast('Resolve machine-readiness blockers before running coverage.'); return; }
  const button = $('#batch-run-btn');
  button.disabled = true; button.textContent = 'Running 24 cases...';
  try {
    state.coverage = runCoverageSweep({ profile: profile(), scenario: state.scenario, environment: state.environment, manifest: state.manifest, readiness: state.validation, baseSeed: Number(dom.seedInput.value) || 42 });
    const summary = state.coverage.summary;
    const rows = [...state.coverage.runs].sort((a, b) => a.metrics.minimumSafetyMargin - b.metrics.minimumSafetyMargin).map((run) => `<tr><td class="${run.status === 'PASS' ? 'coverage-pass' : 'coverage-fail'}">${run.status}</td><td>${run.seed}</td><td>${run.variant.windMps}</td><td>${run.variant.payloadKg}</td><td>${run.variant.initialBatteryPercent}%</td><td>${run.variant.failureTimingOffsetSeconds > 0 ? '+' : ''}${run.variant.failureTimingOffsetSeconds}s</td><td>${run.metrics.minimumSafetyMargin}%</td><td>${run.metrics.peakEstimateError} m</td><td>${run.failedTests}</td></tr>`).join('');
    dom.batchContent.innerHTML = `<section class="coverage-summary"><article><span>RUNS</span><b>${summary.total}</b></article><article><span>PASS RATE</span><b>${summary.passRatePercent}%</b></article><article><span>WORST SAFETY</span><b>${summary.worstSafetyPercent}%</b></article><article><span>PEAK ERROR</span><b>${summary.worstEstimateErrorM} m</b></article></section><p class="helper">Wind, payload, initial battery, and fault timing were swept deterministically. Rows are ordered from the lowest safety margin.</p><div class="table-wrap"><table><thead><tr><th>Status</th><th>Seed</th><th>Wind m/s</th><th>Payload kg</th><th>Battery</th><th>Fault shift</th><th>Min safety</th><th>Peak error</th><th>Failed tests</th></tr></thead><tbody>${rows}</tbody></table></div><p class="helper">${escapeHtml(state.coverage.note)}</p>`;
    dom.batchDialog.showModal();
  } finally {
    button.disabled = false; button.textContent = 'Run coverage sweep';
  }
}

function downloadCoverage() {
  if (!state.coverage) { runBatchCoverage(); return; }
  download(`vidyut-${state.profileId}-coverage.json`, JSON.stringify(state.coverage, null, 2), 'application/json');
}

function exportBackendPackage() {
  const packageData = buildBackendPackage({ backendId: state.backendId, manifest: state.manifest, scenario: state.scenario, environment: state.environment, seed: Number(dom.seedInput.value) || 42 });
  download(`${state.manifest.id}-${state.backendId}-backend.json`, JSON.stringify(packageData, null, 2), 'application/json');
  toast('Backend package exported with FMI and OpenSCENARIO mapping contracts.');
}

function openEvidence() {
  if (!state.engine) resetEngine();
  const report = state.engine.result || state.engine.buildReport();
  const metrics = report.metrics;
  const findings = report.overallAssessment === 'COMPLETE_WITH_FINDINGS';
  const invalid = report.overallAssessment === 'INVALID_RUN';
  dom.reportContent.innerHTML = `<section class="report-hero"><div class="assessment ${invalid ? 'invalid' : findings ? 'findings' : ''}">${escapeHtml(report.overallAssessment.replaceAll('_',' '))}</div><div><h3>${escapeHtml(report.machine.name)} / ${escapeHtml(report.scenario.name)}</h3><p>${escapeHtml(report.note)}</p><span class="report-id">${escapeHtml(report.runId)} / ${report.mode} / seed ${report.deterministicSeed} / ${escapeHtml(report.machineManifestFingerprint || 'no manifest fingerprint')}</span></div></section>
    <section class="report-metrics"><article><span>FINAL DISTANCE</span><b>${metrics.finalDistance} m</b></article><article><span>PEAK ESTIMATE ERROR</span><b>${metrics.peakEstimateError} m</b></article><article><span>MIN SAFETY</span><b>${metrics.minimumSafetyMargin}%</b></article><article><span>FINAL BATTERY</span><b>${metrics.finalBattery}%</b></article></section>
    <section><span class="eyebrow">INDIVIDUAL TEST CASE RESULTS</span>${report.testCases.map((test) => `<article class="test-result"><span class="test-status ${test.status.toLowerCase().replaceAll('_','-')}">${escapeHtml(test.status)}</span><div><b>${escapeHtml(test.name)}</b><small>${escapeHtml(test.assertion)}</small><small>${escapeHtml(test.evidence)}</small>${test.supportingInterval ? `<small>Evidence interval T+${test.supportingInterval.start}-${test.supportingInterval.end} s / ${escapeHtml(test.thresholdSource)}</small>` : ''}</div></article>`).join('') || '<p class="helper">Run the configured plan to evaluate test cases.</p>'}</section>`;
  dom.reportDialog.showModal();
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadManifest() { download(`${state.manifest.id}.vidyut.json`, JSON.stringify(state.manifest, null, 2), 'application/json'); }
function downloadReport() { const report = state.engine.result || state.engine.buildReport(); download(`${report.runId}.json`, JSON.stringify(report, null, 2), 'application/json'); }
function downloadHtmlReport() {
  const report = state.engine.result || state.engine.buildReport();
  const testRows = report.testCases.map((test) => `<tr><td>${escapeHtml(test.status)}</td><td>${escapeHtml(test.name)}</td><td>${escapeHtml(test.assertion)}</td><td>${escapeHtml(test.evidence)}</td><td>${test.supportingInterval ? `${test.supportingInterval.start}-${test.supportingInterval.end} s` : '-'}</td></tr>`).join('');
  const findings = report.findings.map((finding) => `<li><b>${escapeHtml(finding.title)}</b> - ${escapeHtml(finding.evidence)}</li>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(report.runId)} - VIDYUT evidence</title><style>body{font:14px system-ui,sans-serif;color:#142033;max-width:1100px;margin:40px auto;padding:0 24px}header{border-bottom:4px solid #0f766e;padding-bottom:18px}h1{margin:.2rem 0}small{color:#526275}section{margin:28px 0}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.summary div{border:1px solid #ccd6e0;padding:12px}.summary b{display:block;font-size:22px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd6e0;padding:9px;text-align:left;vertical-align:top}th{background:#e8f4f2}pre{white-space:pre-wrap;word-break:break-word;background:#f5f7f9;padding:16px;border:1px solid #ccd6e0}.notice{padding:12px;border-left:4px solid #b45309;background:#fff7ed}@media(max-width:720px){.summary{grid-template-columns:1fr 1fr}table{font-size:11px}}</style></head><body><header><small>BAC VIDYUT / ENGINEERING EVIDENCE V2</small><h1>${escapeHtml(report.machine.name)} - ${escapeHtml(report.scenario.name)}</h1><p>${escapeHtml(report.runId)} / ${escapeHtml(report.overallAssessment)} / ${escapeHtml(report.mode)} / seed ${report.deterministicSeed}</p></header><p class="notice">Assertion-level prototype evidence only. This report is not certification or a whole-machine safety verdict.</p><section class="summary"><div><small>Final distance</small><b>${report.metrics.finalDistance} m</b></div><div><small>Peak estimate error</small><b>${report.metrics.peakEstimateError} m</b></div><div><small>Minimum safety</small><b>${report.metrics.minimumSafetyMargin}%</b></div><div><small>Final battery</small><b>${report.metrics.finalBattery}%</b></div></section><section><h2>Test cases</h2><table><thead><tr><th>Status</th><th>Test</th><th>Assertion</th><th>Measured evidence</th><th>Interval</th></tr></thead><tbody>${testRows}</tbody></table></section><section><h2>Findings</h2><ul>${findings}</ul></section><section><h2>Reproducibility</h2><p>Manifest ${escapeHtml(report.machineManifestFingerprint || 'unavailable')} / scenario ${escapeHtml(report.scenarioFingerprint || 'unavailable')} / simulator ${escapeHtml(`${report.simulator?.id || ''} ${report.simulator?.version || ''}`)}</p></section><section><h2>Complete machine-readable evidence</h2><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></section></body></html>`;
  download(`${report.runId}.html`, html, 'text/html');
}
function downloadCsv() { const data = state.engine.telemetry; if (!data.length) { toast('Run the plan before exporting telemetry.'); return; } const headers = ['t','x','y','observedX','observedY','vx','vy','altitude','heading','targetDistance','stability','battery','perception','link','attitude','jointLoad','latencyMs','computeLoad','packetDelivery','controller','actuatorSequence','actuatorOutputs','faults']; const rows = data.map((row) => headers.map((key) => `"${String(Array.isArray(row[key]) ? row[key].join('|') : row[key] ?? '').replaceAll('"','""')}"`).join(',')); download(`vidyut-${state.profileId}-telemetry.csv`, [headers.join(','), ...rows].join('\n'), 'text/csv'); }

async function loadReplay(file) {
  try {
    const evidence = JSON.parse(await file.text());
    if (!evidence.replay?.scenario) throw new Error('This file does not contain a VIDYUT replay configuration.');
    if (evidence.replay.manifest) {
      state.manifest = normalizeMachineManifest(evidence.replay.manifest);
      const replayProfile = profileFromManifest(state.manifest);
      state.profiles[replayProfile.id] = replayProfile;
      state.profileId = replayProfile.id;
    } else {
      if (state.profiles[evidence.replay.profileId]) state.profileId = evidence.replay.profileId;
      state.manifest = clone(profile().manifest);
    }
    state.scenario = clone(evidence.replay.scenario);
    state.customTests = clone(state.scenario.testDefinitions || []);
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
  selectBackend('vidyut');
  setMode('SIL');
  dom.seedInput.value = 42; dom.speedSelect.value = 3; state.speed = 3; state.guided = true;
  goPage('run'); state.running = true; state.lastFrame = performance.now(); dom.runBtn.textContent = 'Pause run';
  toast('Judge path started: drone / Himalayan range / GNSS + link + wind.');
}

function animationLoop(now) {
  const elapsed = Math.min((now - state.lastFrame) / 1000, .1); state.lastFrame = now;
  if (state.running && state.engine && !state.engine.state.completed) {
    const step = elapsed * state.speed;
    if (state.mode === 'HIL') state.engine.recordHilSession(hil.snapshot());
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
  dom.environmentEditor.addEventListener('change', (event) => {
    const confirmation = event.target.closest('[data-environment-confirm]');
    if (confirmation) { state.environment = { ...state.environment, confirmed: confirmation.checked }; renderPlan(); return; }
    const input = event.target.closest('[data-environment-field]');
    if (!input) return;
    state.environment = { ...state.environment, id: 'custom', name: state.environment.id === 'custom' ? state.environment.name : `Custom ${state.environment.name}`, [input.dataset.environmentField]: Number(input.value), confirmed: false, version: 'custom-v1', provenance: 'User-edited environment values' };
    state.scenario.environmentId = 'custom'; renderEnvironments(); dom.environmentEditor.classList.add('open'); renderPlan();
  });
  dom.testFilters.addEventListener('click', (event) => { const button = event.target.closest('[data-test-filter]'); if (button) { state.testFilter = button.dataset.testFilter; renderTestLibrary(); } });
  dom.testSearch.addEventListener('input', () => { state.testSearch = dom.testSearch.value; renderTestLibrary(); });
  $('#custom-test-toggle').addEventListener('click', () => dom.customTestEditor.classList.toggle('open'));
  $('#custom-test-add').addEventListener('click', addCustomTest);
  dom.testLibrary.addEventListener('change', (event) => { const input = event.target.closest('[data-test-id]'); if (input) toggleTest(input.dataset.testId, input.checked); });
  dom.planEvents.addEventListener('input', (event) => { const input = event.target.closest('[data-event-severity]'); if (!input) return; state.scenario.events[Number(input.dataset.eventSeverity)].severity = Number(input.value) / 100; renderPlan(); });
  dom.generateBtn.addEventListener('click', generateScenario);
  dom.seedInput.addEventListener('change', resetEngine); dom.speedSelect.addEventListener('change', () => state.speed = Number(dom.speedSelect.value));
  dom.backendSelect.addEventListener('change', () => selectBackend(dom.backendSelect.value));
  dom.cameraMode.addEventListener('change', () => provingGround.setCameraMode(dom.cameraMode.value));
  dom.sceneCanvas.addEventListener('camera-mode-change', (event) => { dom.cameraMode.value = event.detail.mode; });
  $$('.segmented button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  dom.hilSafetyConfirm.addEventListener('change', () => { state.manifest.safety.benchChecklistConfirmed = dom.hilSafetyConfirm.checked; });
  dom.connectBtn.addEventListener('click', connectController); $('#estop-btn').addEventListener('click', () => hil.emergencyStop()); $('#clear-estop-btn').addEventListener('click', () => hil.clearEmergencyStop());
  dom.runBtn.addEventListener('click', toggleRun); dom.resetBtn.addEventListener('click', resetEngine);
  $('#batch-run-btn').addEventListener('click', runBatchCoverage); $('#export-adapter-btn').addEventListener('click', exportBackendPackage);
  $('#close-batch').addEventListener('click', () => dom.batchDialog.close()); $('#download-batch').addEventListener('click', downloadCoverage); $('#rerun-batch').addEventListener('click', () => { dom.batchDialog.close(); runBatchCoverage(); });
  dom.evidenceBtn.addEventListener('click', openEvidence); $('#close-report').addEventListener('click', () => dom.reportDialog.close()); $('#download-report').addEventListener('click', downloadReport); $('#download-html').addEventListener('click', downloadHtmlReport); $('#download-csv').addEventListener('click', downloadCsv); dom.replayInput.addEventListener('change', () => loadReplay(dom.replayInput.files[0]));
  dom.guidedDemoBtn.addEventListener('click', startGuidedDemo); dom.guidedRunBtn.addEventListener('click', startGuidedDemo);
  dom.gripperConnectBtn.addEventListener('click', async () => {
    try {
      if (gripper.connected) { await gripper.disconnect(); dom.gripperConnectBtn.textContent = 'Connect'; return; }
      if (!dom.gripperSafetyConfirm.checked) throw new Error('Complete the live-gripper safety confirmation first.');
      await gripper.connect(); dom.gripperConnectBtn.textContent = 'Disconnect';
    } catch (error) { if (error.name !== 'NotFoundError') toast(error.message); }
  });
  $$('[data-gripper-move]').forEach((button) => button.addEventListener('click', async () => {
    try {
      if (!dom.gripperSafetyConfirm.checked) throw new Error('Complete the safety confirmation first.');
      const offset = Number(button.dataset.gripperMove);
      if (offset === 0) await gripper.center(); else await gripper.move(offset);
    } catch (error) { toast(error.message); }
  }));
  dom.gripperUnsafeBtn.addEventListener('click', () => gripper.move(30).catch((error) => toast(error.message)));
  dom.gripperStopBtn.addEventListener('click', () => gripper.stop().catch((error) => toast(error.message)));
  const appendGripperLog = (direction, line) => {
    const entry = `${new Date().toLocaleTimeString()}  ${direction} ${line}`;
    dom.gripperLog.textContent = `${entry}\n${dom.gripperLog.textContent}`.split('\n').slice(0, 8).join('\n');
  };
  gripper.addEventListener('tx', (event) => appendGripperLog('→', event.detail));
  gripper.addEventListener('rx', (event) => appendGripperLog('←', event.detail));
  gripper.addEventListener('status', (event) => { dom.gripperStatus.textContent = event.detail; toast(event.detail); });
  gripper.addEventListener('ack', (event) => {
    const offset = event.detail.offset;
    dom.gripperTwin.style.setProperty('--grip', `${offset * 2.2}deg`);
    dom.gripperAngle.textContent = `${offset.toFixed(1)}° ACKNOWLEDGED`;
    dom.gripperStatus.textContent = `Command ${event.detail.sequence} physically issued`;
  });
  gripper.addEventListener('rejected', (event) => { dom.gripperStatus.textContent = 'Unsafe command rejected — no motion'; toast('Safety proof passed: +30° was rejected by firmware.'); appendGripperLog('✓', 'NO MOTION / RANGE GUARD PASSED'); });
  gripper.addEventListener('error', (event) => toast(event.detail));
  hil.addEventListener('telemetry', (event) => { state.hardwareSample = event.detail; dom.controllerIo.textContent = JSON.stringify(event.detail, null, 2); });
  hil.addEventListener('actuators', (event) => { state.actuatorCommand = event.detail; dom.controllerIo.textContent = JSON.stringify(event.detail, null, 2); });
  hil.addEventListener('status', (event) => {
    dom.connectorDetail.textContent = event.detail.detail;
    dom.connectBtn.textContent = event.detail.connected ? 'Disconnect' : 'Connect';
    if (event.detail.emergencyStopped) { state.running = false; dom.runBtn.textContent = 'Resume run'; }
    toast(event.detail.detail);
  });
  hil.addEventListener('integrity', (event) => { dom.controllerIo.textContent = JSON.stringify({ integrity: event.detail.integrity, handshake: event.detail.handshake, detail: event.detail.detail }, null, 2); });
  hil.addEventListener('error', (event) => toast(event.detail.message || 'Controller bridge error.'));
  window.addEventListener('resize', () => { if (state.page === 'run' && state.engine) updateUI(state.engine.snapshot()); });
}

function init() {
  state.validation = validateMachineManifest(state.manifest);
  bindEvents();
  renderMachine(); renderScenario(); resetEngine(); renderRunConfiguration(); checkAiStatus(); refreshBackendStatus();
  requestAnimationFrame(animationLoop);
  if (new URLSearchParams(window.location.search).get('demo') === '1') setTimeout(startGuidedDemo, 120);
}

init();
