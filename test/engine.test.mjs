import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENTS, TEST_LIBRARY, scenarioFromTests } from '../public/js/catalog.js';
import { MACHINE_PROFILES, PRESET_SCENARIOS, profileFromManifest, validateMachineManifest as validateProfileManifest } from '../public/js/profiles.js';
import { VidyutEngine, validateScenario } from '../public/js/engine.js';
import { HilBridge } from '../public/js/hil.js';
import { createStarterManifest, importMachineFiles, manifestFingerprint, normalizeMachineManifest, parseGltf, parseKicadNetlist, parseStep, parseUrdf, parseYamlManifest, parseZipArchive, validateMachineManifest } from '../public/js/manifest.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const fileName = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26);
    localParts.push(local, fileName, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

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

test('project-specific tests execute through a validated fault hook and retain their assertion', () => {
  const definition = { id: 'custom-ridge-wind', name: 'Ridge wind recovery', category: 'Custom', fault: 'wind_gust', appliesTo: ['aerial'], defaultSeverity: .66, duration: 5, assertion: 'Record attitude recovery after the ridge gust.', description: 'Project-specific wind case.', custom: true };
  const scenario = scenarioFromTests(MACHINE_PROFILES.drone, [definition], { environmentId: 'himalayan' });
  scenario.testDefinitions = [definition];
  const engine = complete('drone', 44, scenario);
  const result = engine.result.testCases.find((item) => item.id === definition.id);
  assert.equal(result.name, definition.name);
  assert.equal(result.assertion, definition.assertion);
  assert.ok(['PASS', 'FAIL'].includes(result.status));
});

test('all reference machine manifests pass electrical readiness', () => {
  for (const [id, profile] of Object.entries(MACHINE_PROFILES)) {
    const validation = validateMachineManifest(profile.manifest);
    assert.equal(validation.ready, true, `${id}: ${validation.issues.map((item) => item.message).join(' ')}`);
    assert.equal(validation.summary.blockers, 0);
    assert.equal(validation.summary.warnings, 0);
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

test('readiness covers SPI select, UART rate, CAN identity, safety, and mechanical consistency', () => {
  const manifest = createStarterManifest({
    id: 'bus-errors', name: 'Bus errors', family: 'ground',
    physical: { totalMassKg: 5, centerOfMass: [0, 0, 0], confirmed: true },
    geometry: { format: 'sdf', fileName: 'bus-errors.sdf', units: 'm', confirmed: true, links: [{ id: 'body', name: 'Body', massKg: 2, inertia: [1, 1, 1], collision: 'box' }] },
    safety: { physicalActuatorsDisabled: false, emergencyStopRequired: false },
    components: [
      { id: 'supply', name: 'Supply', kind: 'power-source', output: { voltage: 5, maxCurrentA: 10 }, pins: [{ id: 'V+', mode: 'power' }] },
      { id: 'ctrl', name: 'Controller', kind: 'controller', baudRate: 115200, input: { minVoltage: 4.5, maxVoltage: 5.5, currentA: .2 }, pins: [{ id: 'VCC', mode: 'power' }, { id: 'CS', mode: 'signal' }, { id: 'TX', mode: 'tx' }] },
      { id: 'spi-a', name: 'SPI A', kind: 'sensor', input: { minVoltage: 4.5, maxVoltage: 5.5, currentA: .1 }, pins: [{ id: 'VCC', mode: 'power' }, { id: 'CS', mode: 'signal' }] },
      { id: 'spi-b', name: 'SPI B', kind: 'sensor', input: { minVoltage: 4.5, maxVoltage: 5.5, currentA: .1 }, pins: [{ id: 'VCC', mode: 'power' }, { id: 'CS', mode: 'signal' }] },
      { id: 'uart', name: 'UART device', kind: 'sensor', baudRate: 57600, input: { minVoltage: 4.5, maxVoltage: 5.5, currentA: .1 }, pins: [{ id: 'VCC', mode: 'power' }, { id: 'RX', mode: 'rx' }] },
      { id: 'can-a', name: 'CAN A', kind: 'module', bus: 'can', busId: 'can-0', canId: '0x21', canTermination: true },
      { id: 'can-b', name: 'CAN B', kind: 'module', bus: 'can', busId: 'can-0', canId: '0x21', canTermination: false }
    ],
    connections: [
      ...['ctrl', 'spi-a', 'spi-b', 'uart'].map((id, index) => ({ id: `p${index}`, kind: 'power', from: { component: 'supply', pin: 'V+' }, to: { component: id, pin: 'VCC' } })),
      { id: 'cs-a', kind: 'signal', signal: 'spi-cs', from: { component: 'ctrl', pin: 'CS' }, to: { component: 'spi-a', pin: 'CS' } },
      { id: 'cs-b', kind: 'signal', signal: 'spi-cs', from: { component: 'ctrl', pin: 'CS' }, to: { component: 'spi-b', pin: 'CS' } },
      { id: 'uart-rate', kind: 'signal', signal: 'uart', from: { component: 'ctrl', pin: 'TX' }, to: { component: 'uart', pin: 'RX' } }
    ]
  });
  const codes = new Set(validateMachineManifest(manifest).issues.map((item) => item.code));
  for (const code of ['MASS_SUM_MISMATCH', 'SPI_CHIP_SELECT_REUSED', 'UART_BAUD_MISMATCH', 'CAN_ID_CONFLICT', 'CAN_TERMINATION_UNCONFIRMED', 'PHYSICAL_OUTPUTS_NOT_DISABLED', 'EMERGENCY_STOP_REQUIRED']) assert.ok(codes.has(code), code);
});

test('YAML, glTF/GLB, and verified ZIP package imports are executable ingestion paths', async () => {
  const yaml = `schema: vidyut.machine.v2\nversion: 2\nid: yaml-drone\nname: YAML Drone\nfamily: aerial\nphysical:\n  totalMassKg: 2.4\n  centerOfMass: [0, 0, -0.03]\n  confirmed: false\ncomponents:\n  - id: battery\n    name: Battery\n    kind: power-source\n    output: {voltage: 14.8, maxCurrentA: 30}\nconnections: []`;
  const parsedYaml = parseYamlManifest(yaml);
  assert.equal(parsedYaml.name, 'YAML Drone');
  assert.equal(parsedYaml.components[0].output.voltage, 14.8);

  const gltfText = JSON.stringify({ asset: { version: '2.0', generator: 'VIDYUT test' }, scenes: [{ nodes: [0] }], nodes: [{ name: 'Body', mesh: 0 }], meshes: [{ primitives: [] }], materials: [] });
  const gltf = parseGltf(gltfText, 'preview.gltf');
  assert.equal(gltf.geometry.preview.meshCount, 1);
  assert.equal(gltf.geometry.links[0].name, 'Body');
  assert.equal(gltf.physical.totalMassKg, null);
  const jsonBytes = Buffer.from(gltfText);
  const paddedLength = Math.ceil(jsonBytes.length / 4) * 4;
  const glb = Buffer.alloc(20 + paddedLength, 0x20);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(paddedLength, 12); glb.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(glb, 20);
  const parsedGlb = parseGltf(glb, 'preview.glb');
  assert.equal(parsedGlb.geometry.format, 'glb');
  assert.equal(parsedGlb.geometry.preview.nodeCount, 1);

  const archive = storedZip({ 'machine.yaml': yaml, 'preview.gltf': gltfText });
  const entries = await parseZipArchive(archive);
  assert.deepEqual(entries.map((entry) => entry.name), ['machine.yaml', 'preview.gltf']);
  const result = await importMachineFiles([{ name: 'yaml-drone.vidyut.zip', size: archive.length, type: 'application/zip', arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength), text: async () => '' }]);
  assert.equal(result.manifest.name, 'YAML Drone');
  assert.equal(result.manifest.geometry.format, 'gltf');
  assert.ok(result.manifest.sourceFiles.some((source) => source.name === 'yaml-drone.vidyut.zip'));
  assert.ok(result.manifest.sourceFiles.every((source) => /^(sha256|fnv1a)-/.test(source.hash)));
  assert.equal(result.manifest.identity.sourceHashes.length, result.manifest.sourceFiles.length);
  assert.ok(result.notices.some((notice) => /verified and expanded/.test(notice.message)));
});

test('the HIL bridge enforces handshake, clamps outputs, and latches bench-safe state', async () => {
  const synthetic = new HilBridge();
  await synthetic.connect();
  assert.equal(synthetic.ready, true);
  await synthetic.publishSensorFrame({ t: 1, x: 1, y: 2, altitude: 3, vx: 0, vy: 0, heading: 0, observedX: 1, observedY: 2, battery: 99, attitude: 0, stability: 100, perception: 100, link: 100 }, ENVIRONMENTS[0], []);
  assert.deepEqual(synthetic.lastActuators.outputs, [.45, .46, .45, .44]);
  assert.equal(synthetic.lastActuators.armed, false);
  await synthetic.emergencyStop();
  assert.equal(synthetic.ready, false);
  await synthetic.clearEmergencyStop();
  assert.equal(synthetic.ready, true);
  await synthetic.disconnect();

  const real = new HilBridge();
  real.connected = true;
  real.receive({ type: 'actuator_command', sequence: 1, outputs: [2, -3], armed: true });
  assert.equal(real.lastActuators, null);
  assert.equal(real.integrity.rejected, 1);
  real.receive({ type: 'hello_ack', protocol: 'vidyut.hil.v1', benchSafe: true, controller: 'test-controller', firmware: '1.0.0' });
  assert.equal(real.handshake.acknowledged, true);
  real.receive({ type: 'actuator_command', sequence: 2, outputs: [2, -3], armed: true });
  assert.deepEqual(real.lastActuators.outputs, [1, -1]);
  assert.equal(real.lastActuators.armed, false);
  assert.equal(real.integrity.saturated, 1);
  assert.ok(real.integrity.rejected >= 2);
});

test('HIL evidence records controller outputs and invalidates watchdog-compromised runs', () => {
  const profile = MACHINE_PROFILES.drone;
  const scenario = PRESET_SCENARIOS.drone[0];
  const valid = new VidyutEngine(profile, scenario, { mode: 'HIL', adapter: 'synthetic-web-serial', environment: ENVIRONMENTS[0], manifest: profile.manifest });
  const session = { connected: true, synthetic: true, emergencyStopped: false, handshake: { acknowledged: true, controller: 'synthetic', firmware: 'test' }, integrity: { watchdogTrips: 0, malformed: 0, rejected: 0, saturated: 0, droppedSequences: 0, outOfOrder: 0 } };
  valid.recordHilSession(session);
  while (!valid.state.completed) valid.step(.05, null, { sequence: Math.round(valid.state.t * 20) + 1, outputs: [.45, .46, .45, .44], armed: false, controllerState: 'HIL TRACKING' });
  assert.ok(['COMPLETE', 'COMPLETE_WITH_FINDINGS'].includes(valid.result.overallAssessment));
  assert.ok(valid.result.controllerEvidence.actuatorCommands.length > 20);
  assert.equal(valid.result.controller.physicalActuatorsDisabled, true);

  const invalid = new VidyutEngine(profile, scenario, { mode: 'HIL', adapter: 'web-serial', environment: ENVIRONMENTS[0], manifest: profile.manifest });
  invalid.recordHilSession({ connected: true, synthetic: false, emergencyStopped: true, handshake: { acknowledged: true, controller: 'bench', firmware: '1.0' }, integrity: { watchdogTrips: 1 } });
  while (!invalid.state.completed) invalid.step(.05, null, { sequence: 1, outputs: [0, 0, 0, 0], armed: false });
  assert.equal(invalid.result.overallAssessment, 'INVALID_RUN');
  assert.ok(invalid.result.testCases.every((item) => item.status === 'NOT_EVALUATED'));
  assert.match(invalid.result.integrity.reasons.join(' '), /watchdog/i);
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
