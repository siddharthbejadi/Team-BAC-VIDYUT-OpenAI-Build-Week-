import test from 'node:test';
import assert from 'node:assert/strict';
import { MACHINE_PROFILES, PRESET_SCENARIOS, profileFromManifest, validateMachineManifest } from '../public/js/profiles.js';
import { VidyutEngine, validateScenario } from '../public/js/engine.js';

function complete(profileId, seed = 42) {
  const engine = new VidyutEngine(MACHINE_PROFILES[profileId], PRESET_SCENARIOS[profileId][0], { seed });
  while (!engine.state.completed) engine.step(.05);
  return engine;
}

test('all three reference machine families produce evidence', () => {
  for (const profileId of ['drone', 'rover', 'humanoid']) {
    const engine = complete(profileId);
    assert.equal(engine.result.schema, 'vidyut.evidence.v1');
    assert.equal(engine.result.machine.id, profileId);
    assert.ok(engine.result.telemetry.length > 80);
    assert.ok(['PASS', 'REVIEW'].includes(engine.result.verdict));
  }
});

test('the simulation is deterministic for the same seed and inputs', () => {
  const first = complete('drone', 712);
  const second = complete('drone', 712);
  assert.deepEqual(first.result.metrics, second.result.metrics);
  assert.deepEqual(first.telemetry, second.telemetry);
});

test('faults are injected and recovery is recorded', () => {
  const engine = complete('drone');
  assert.ok(engine.logs.some((entry) => entry.level === 'fault' && entry.text.includes('gnss drift')));
  assert.ok(engine.logs.some((entry) => entry.level === 'action'));
  assert.ok(engine.result.metrics.recoveryTime > 0);
});

test('unsupported faults are rejected before execution', () => {
  const scenario = structuredClone(PRESET_SCENARIOS.drone[0]);
  scenario.events[0].fault = 'laser_shark';
  const result = validateScenario(scenario, MACHINE_PROFILES.drone);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /not supported/);
});

test('a valid custom machine manifest becomes an executable profile', () => {
  const manifest = {
    id: 'amr-1', name: 'Warehouse AMR', family: 'ground',
    faults: ['wheel_slip', 'camera_occlusion'], capabilities: ['odometry']
  };
  assert.equal(validateMachineManifest(manifest).valid, true);
  const custom = profileFromManifest(manifest);
  assert.equal(custom.name, 'Warehouse AMR');
  assert.equal(custom.family, 'Ground');
  assert.equal(custom.target.x, MACHINE_PROFILES.rover.target.x);
});
