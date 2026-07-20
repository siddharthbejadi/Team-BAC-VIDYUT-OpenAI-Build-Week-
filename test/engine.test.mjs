import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENTS, TEST_LIBRARY, scenarioFromTests } from '../public/js/catalog.js';
import { MACHINE_PROFILES, PRESET_SCENARIOS, profileFromManifest, validateMachineManifest as validateProfileManifest } from '../public/js/profiles.js';
import { VidyutEngine, validateScenario } from '../public/js/engine.js';
import { createStarterManifest, manifestFingerprint, normalizeMachineManifest, parseKicadNetlist, parseStep, parseUrdf, validateMachineManifest } from '../public/js/manifest.js';

function complete(profileId, seed = 42, scenario = PRESET_SCENARIOS[profileId][0]) {
  const profile = MACHINE_PROFILES[profileId];
  const environment = ENVIRONMENTS.find((item) => item.id === scenario.environmentId) || ENVIRONMENTS[0];
  const readiness = validateMachineManifest(profile.manifest);
  const engine = new VidyutEngine(profile, scenario, { seed, environment, manifest: profile.manifest, readiness });
  while (!engine.state.completed) engine.step(.05);
  return engine;
}

test('all four reference machine families produce v2 evidence with individual results', () => {
  for (const profileId of ['drone', 'rover', 'humanoid', 'spacecraft']) {
    const engine = complete(profileId);
    assert.equal(engine.result.schema, 'vidyut.evidence.v2');
    assert.equal(engine.result.machine.id, profileId);
    assert.ok(engine.result.telemetry.length > 80);
    assert.ok(['COMPLETE', 'COMPLETE_WITH_FINDINGS'].includes(engine.result.overallAssessment));
    assert.ok(engine.result.testCases.length > 0);
    assert.ok(engine.result.testCases.every((item) => ['PASS', 'FAIL', 'NOT_RUN', 'NOT_EVALUATED'].includes(item.status)));
    assert.match(engine.result.machineManifestFingerprint, /^fnv1a-/);
  }
});

test('the simulation is deterministic for the same seed and inputs', () => {
  const first = complete('drone', 712);
  const second = complete('drone', 712);
  assert.deepEqual(first.result.metrics, second.result.metrics);
  assert.deepEqual(first.telemetry, second.telemetry);
  assert.deepEqual(first.result.testCases, second.result.testCases);
});

test('faults are injected and recovery is recorded', () => {
  const engine = complete('drone');
  assert.ok(engine.logs.some((entry) => entry.level === 'fault' && entry.text.includes('gnss drift')));
  assert.ok(engine.logs.some((entry) => entry.level === 'action'));
  assert.ok(engine.result.metrics.recoveryTime > 0);
  assert.equal(engine.result.testCases.find((item) => item.id === 'command-link-loss').status, 'PASS');
});

test('evidence opened before execution is explicitly not run', () => {
  const profile = MACHINE_PROFILES.drone;
  const engine = new VidyutEngine(profile, PRESET_SCENARIOS.drone[0], { environment: ENVIRONMENTS[0], manifest: profile.manifest });
  const report = engine.buildReport();
  assert.equal(report.overallAssessment, 'NOT_RUN');
  assert.ok(report.testCases.every((item) => item.status === 'NOT_RUN'));
});

test('unsupported faults are rejected before execution', () => {
  const scenario = structuredClone(PRESET_SCENARIOS.drone[0]);
  scenario.events[0].fault = 'laser_shark';
  const result = validateScenario(scenario, MACHINE_PROFILES.drone);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /not supported/);
});

test('the default library contains exactly 25 executable test templates', () => {
  assert.equal(TEST_LIBRARY.length, 25);
  assert.equal(new Set(TEST_LIBRARY.map((item) => item.id)).size, 25);
  for (const definition of TEST_LIBRARY) {
    const family = definition.appliesTo[0];
    const profileId = family === 'aerial' ? 'drone' : family === 'ground' ? 'rover' : family === 'legged' ? 'humanoid' : 'spacecraft';
    const profile = MACHINE_PROFILES[profileId];
    const scenario = scenarioFromTests(profile, [definition], { environmentId: 'himalayan' });
    assert.ok(scenario.events.length > 0, `${definition.id} should produce an event`);
    assert.equal(validateScenario(scenario, profile).valid, true, definition.id);
    const engine = complete(profileId, 42, scenario);
    assert.ok(engine.result.testCases.some((item) => item.id === definition.id), definition.id);
  }
});

test('all reference machine manifests pass electrical readiness', () => {
  for (const [id, profile] of Object.entries(MACHINE_PROFILES)) {
    const validation = validateMachineManifest(profile.manifest);
    assert.equal(validation.ready, true, `${id}: ${validation.issues.map((item) => item.message).join(' ')}`);
    assert.equal(validation.summary.blockers, 0);
  }
});

test('electrical readiness detects voltage, duplicate drivers, address conflicts, and power budget', () => {
  const manifest = createStarterManifest({
    id: 'invalid-rig', name: 'Invalid rig', family: 'ground',
    components: [
      { id: 'battery', name: '24 V source', kind: 'power-source', output: { voltage: 24, maxCurrentA: 1 }, pins: [{ id: 'V+', mode: 'power' }] },
      { id: 'ctrl', name: 'Controller', kind: 'controller', input: { minVoltage: 4.75, maxVoltage: 5.25, currentA: 2 }, bus: 'i2c', address: '0x40', pins: [{ id: 'VCC', mode: 'power' }, { id: 'OUT', mode: 'signal' }] },
      { id: 'sensor', name: 'Sensor', kind: 'sensor', input: { minVoltage: 3, maxVoltage: 5.5, currentA: .2 }, bus: 'i2c', address: '0x40', pins: [{ id: 'VCC', mode: 'power' }, { id: 'IN', mode: 'signal' }] }
    ],
    connections: [
      { id: 'p1', kind: 'power', from: { component: 'battery', pin: 'V+' }, to: { component: 'ctrl', pin: 'VCC' } },
      { id: 'p2', kind: 'power', from: { component: 'battery', pin: 'V+' }, to: { component: 'sensor', pin: 'VCC' } },
      { id: 's1', kind: 'signal', from: { component: 'ctrl', pin: 'OUT' }, to: { component: 'sensor', pin: 'IN' } },
      { id: 's2', kind: 'signal', from: { component: 'ctrl', pin: 'OUT' }, to: { component: 'sensor', pin: 'IN' } }
    ]
  });
  const validation = validateMachineManifest(manifest);
  const codes = new Set(validation.issues.map((item) => item.code));
  assert.equal(validation.ready, false);
  for (const code of ['VOLTAGE_INCOMPATIBLE', 'PIN_DRIVEN_TWICE', 'I2C_ADDRESS_CONFLICT', 'POWER_BUDGET_EXCEEDED']) assert.ok(codes.has(code), code);
});

test('URDF, STEP, and KiCad imports preserve their distinct responsibilities', () => {
  const urdf = parseUrdf(`<robot name="arm"><link name="base"><inertial><origin xyz="0 0 .1"/><mass value="2.5"/><inertia ixx="1" iyy="2" izz="3"/></inertial><collision><geometry><box size="1 1 1"/></geometry></collision></link><link name="tool"><inertial><mass value=".5"/></inertial></link><joint name="axis" type="revolute"><parent link="base"/><child link="tool"/><limit lower="-1" upper="1" effort="5" velocity="2"/></joint></robot>`, 'arm.urdf');
  assert.equal(urdf.geometry.links.length, 2);
  assert.equal(urdf.geometry.joints[0].type, 'revolute');
  assert.equal(urdf.physical.totalMassKg, 3);
  assert.equal(urdf.geometry.confirmed, false);

  const step = parseStep("FILE_NAME('frame.step','2026');#1=PRODUCT('FRAME','',(),());#2=SI_UNIT(.MILLI.,.METRE.);", 'frame.step');
  assert.equal(step.geometry.format, 'step');
  assert.equal(step.geometry.units, 'mm');
  assert.equal(step.physical.totalMassKg, null);
  assert.match(step.assumptions[0], /does not reliably provide wiring/i);

  const net = parseKicadNetlist(`<export><components><comp ref="U1"><value>STM32</value></comp><comp ref="J1"><value>SENSOR</value></comp></components><nets><net code="1" name="SDA"><node ref="U1" pin="10"/><node ref="J1" pin="2"/></net></nets></export>`, 'board.net');
  assert.equal(net.components.length, 2);
  assert.equal(net.connections[0].net, 'SDA');
});

test('legacy custom profiles normalize without pretending to be test-ready', () => {
  const legacy = { id: 'amr-1', name: 'Warehouse AMR', family: 'ground', faults: ['wheel_slip'], capabilities: ['odometry'] };
  assert.equal(validateProfileManifest(legacy).valid, true);
  const normalized = normalizeMachineManifest(legacy);
  const custom = profileFromManifest(normalized);
  assert.equal(custom.name, 'Warehouse AMR');
  assert.equal(custom.family, 'Ground');
  assert.equal(validateMachineManifest(normalized).ready, false);
  assert.equal(manifestFingerprint(normalized), manifestFingerprint(normalized));
});
