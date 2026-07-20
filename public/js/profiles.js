import { FAULT_LIBRARY, testsForFamily } from './catalog.js';
import { createStarterManifest, normalizeMachineManifest, validateMachineManifest as validateV2Manifest } from './manifest.js';

export { FAULT_LIBRARY } from './catalog.js';

const pins = (...items) => items.map(([id, mode, extra = {}]) => ({ id, name: id, mode, ...extra }));

const controller = (id, name) => ({
  id, name, kind: 'controller', partNumber: name,
  input: { minVoltage: 4.75, maxVoltage: 5.25, currentA: .8 },
  pins: pins(['5V', 'power'], ['GND', 'ground'], ['PWM1', 'pwm'], ['PWM2', 'pwm'], ['TX1', 'tx'], ['RX1', 'rx'], ['SDA', 'i2c'], ['SCL', 'i2c'])
});

const battery = (voltage, current = 40) => ({
  id: 'battery', name: `${voltage} V battery`, kind: 'power-source',
  output: { voltage, maxCurrentA: current }, pins: pins(['VBAT+', 'power'], ['GND', 'ground'])
});

const defaultManifest = (id, name, family, physical, components, connections, extra = {}) => createStarterManifest({
  id, name, family, physical: { ...physical, confirmed: true },
  geometry: { format: extra.geometryFormat || 'reference-model', fileName: extra.geometryFile || `${id}.reference`, units: 'm', links: extra.links || [{ id: 'body', name: 'Main body', massKg: physical.totalMassKg, centerOfMass: physical.centerOfMass || [0, 0, 0], inertia: physical.inertia || [.1, .1, .1], collision: 'convex-hull' }], joints: extra.joints || [], confirmed: true },
  components, connections, interfaces: [{ id: `${id}-controller`, transport: 'web-serial', baudRate: 115200, protocol: 'vidyut.hil.v1', benchSafe: true }],
  capabilities: extra.capabilities || [], faults: testsForFamily(family).flatMap((test) => test.fault === 'multi_fault' ? [] : [test.fault]),
  objective: extra.objective, passRules: extra.passRules,
  confirmations: ['Reference profile physical values', 'Reference profile pin mapping', 'Bench-safe controller interface']
});

const droneComponents = [
  battery(14.8, 60),
  { id: 'power-module', name: '5 V power module', kind: 'regulator', input: { minVoltage: 10, maxVoltage: 25, currentA: .2 }, output: { voltage: 5, maxCurrentA: 5 }, pins: pins(['VIN', 'power'], ['5V', 'power'], ['GND', 'ground']) },
  controller('flight-controller', 'PX4-compatible flight controller'),
  { id: 'imu', name: '6-axis IMU', kind: 'sensor', bus: 'i2c', address: '0x68', input: { minVoltage: 3.3, maxVoltage: 5.25, currentA: .05 }, pins: pins(['VCC', 'power'], ['GND', 'ground'], ['SDA', 'i2c'], ['SCL', 'i2c']) },
  { id: 'esc-1', name: 'Motor 1 ESC', kind: 'actuator', input: { minVoltage: 10, maxVoltage: 20, currentA: 9 }, pins: pins(['VBAT', 'power'], ['GND', 'ground'], ['PWM', 'pwm', { minFrequencyHz: 50, maxFrequencyHz: 500 }]) },
  { id: 'esc-2', name: 'Motor 2 ESC', kind: 'actuator', input: { minVoltage: 10, maxVoltage: 20, currentA: 9 }, pins: pins(['VBAT', 'power'], ['GND', 'ground'], ['PWM', 'pwm', { minFrequencyHz: 50, maxFrequencyHz: 500 }]) }
];

const droneConnections = [
  ['battery', 'VBAT+', 'power-module', 'VIN', 'power'], ['power-module', '5V', 'flight-controller', '5V', 'power'], ['power-module', '5V', 'imu', 'VCC', 'power'],
  ['battery', 'VBAT+', 'esc-1', 'VBAT', 'power'], ['battery', 'VBAT+', 'esc-2', 'VBAT', 'power'],
  ['flight-controller', 'PWM1', 'esc-1', 'PWM', 'signal', 'pwm', 400], ['flight-controller', 'PWM2', 'esc-2', 'PWM', 'signal', 'pwm', 400],
  ['flight-controller', 'SDA', 'imu', 'SDA', 'signal', 'i2c'], ['flight-controller', 'SCL', 'imu', 'SCL', 'signal', 'i2c']
].map(([fromComponent, fromPin, toComponent, toPin, kind, signal, frequencyHz], index) => ({ id: `wire-${index + 1}`, kind, signal, frequencyHz, from: { component: fromComponent, pin: fromPin }, to: { component: toComponent, pin: toPin } }));

const roverComponents = [
  battery(12, 35),
  { id: 'regulator', name: '5 V regulator', kind: 'regulator', input: { minVoltage: 9, maxVoltage: 16, currentA: .2 }, output: { voltage: 5, maxCurrentA: 6 }, pins: pins(['VIN', 'power'], ['5V', 'power'], ['GND', 'ground']) },
  controller('rover-controller', 'STM32 rover controller'),
  { id: 'lidar', name: '2D LiDAR', kind: 'sensor', bus: 'uart', input: { minVoltage: 4.75, maxVoltage: 5.25, currentA: .6 }, pins: pins(['5V', 'power'], ['GND', 'ground'], ['TX', 'tx'], ['RX', 'rx']) },
  { id: 'drive', name: 'Dual motor driver', kind: 'actuator', input: { minVoltage: 9, maxVoltage: 16, currentA: 12 }, pins: pins(['VBAT', 'power'], ['GND', 'ground'], ['PWM', 'pwm', { minFrequencyHz: 50, maxFrequencyHz: 20000 }]) }
];

const roverConnections = [
  ['battery', 'VBAT+', 'regulator', 'VIN', 'power'], ['regulator', '5V', 'rover-controller', '5V', 'power'], ['regulator', '5V', 'lidar', '5V', 'power'], ['battery', 'VBAT+', 'drive', 'VBAT', 'power'],
  ['rover-controller', 'PWM1', 'drive', 'PWM', 'signal', 'pwm', 1000], ['rover-controller', 'TX1', 'lidar', 'RX', 'signal', 'uart'], ['lidar', 'TX', 'rover-controller', 'RX1', 'signal', 'uart']
].map(([fromComponent, fromPin, toComponent, toPin, kind, signal, frequencyHz], index) => ({ id: `wire-${index + 1}`, kind, signal, frequencyHz, from: { component: fromComponent, pin: fromPin }, to: { component: toComponent, pin: toPin } }));

const humanoidComponents = [
  battery(7.4, 30),
  { id: 'regulator', name: '5 V buck regulator', kind: 'regulator', input: { minVoltage: 6, maxVoltage: 12, currentA: .2 }, output: { voltage: 5, maxCurrentA: 8 }, pins: pins(['VIN', 'power'], ['5V', 'power'], ['GND', 'ground']) },
  controller('brain', 'NVIDIA Jetson / STM32 controller'),
  { id: 'pwm-board', name: 'PCA9685 16-channel PWM', kind: 'actuator-controller', bus: 'i2c', address: '0x40', input: { minVoltage: 4.5, maxVoltage: 5.5, currentA: .15 }, pins: pins(['VCC', 'power'], ['GND', 'ground'], ['SDA', 'i2c'], ['SCL', 'i2c'], ['PWM0', 'pwm']) },
  { id: 'servo-hip', name: 'Hip servo', kind: 'actuator', input: { minVoltage: 4.8, maxVoltage: 8.4, currentA: 2.2 }, pins: pins(['V+', 'power'], ['GND', 'ground'], ['PWM', 'pwm', { minFrequencyHz: 40, maxFrequencyHz: 333 }]) },
  { id: 'imu', name: 'Balance IMU', kind: 'sensor', bus: 'i2c', address: '0x68', input: { minVoltage: 3.3, maxVoltage: 5.25, currentA: .05 }, pins: pins(['VCC', 'power'], ['GND', 'ground'], ['SDA', 'i2c'], ['SCL', 'i2c']) }
];

const humanoidConnections = [
  ['battery', 'VBAT+', 'regulator', 'VIN', 'power'], ['regulator', '5V', 'brain', '5V', 'power'], ['regulator', '5V', 'pwm-board', 'VCC', 'power'], ['battery', 'VBAT+', 'servo-hip', 'V+', 'power'], ['regulator', '5V', 'imu', 'VCC', 'power'],
  ['brain', 'SDA', 'pwm-board', 'SDA', 'signal', 'i2c'], ['brain', 'SCL', 'pwm-board', 'SCL', 'signal', 'i2c'], ['pwm-board', 'PWM0', 'servo-hip', 'PWM', 'signal', 'pwm', 50], ['brain', 'SDA', 'imu', 'SDA', 'signal', 'i2c'], ['brain', 'SCL', 'imu', 'SCL', 'signal', 'i2c']
].map(([fromComponent, fromPin, toComponent, toPin, kind, signal, frequencyHz], index) => ({ id: `wire-${index + 1}`, kind, signal, frequencyHz, from: { component: fromComponent, pin: fromPin }, to: { component: toComponent, pin: toPin } }));

const manifests = {
  drone: defaultManifest('drone', 'VX-4 Quadcopter', 'aerial', { totalMassKg: 2.3, centerOfMass: [0, 0, -.04], inertia: [.04, .04, .07] }, droneComponents, droneConnections, { capabilities: ['position', 'altitude', 'attitude', 'link', 'battery'], objective: 'Reach the inspection waypoint and recover within the safety corridor.', passRules: ['Position error < 18 m', 'Attitude < 28 deg', 'Battery > 20%'] }),
  rover: defaultManifest('rover', 'TR-7 Ground Rover', 'ground', { totalMassKg: 18.4, centerOfMass: [.08, 0, .22], inertia: [1.2, 2.1, 2.5] }, roverComponents, roverConnections, { capabilities: ['odometry', 'vision', 'steering', 'link', 'battery'], objective: 'Navigate to the delivery zone without entering the exclusion area.', passRules: ['Cross-track error < 14 m', 'Perception > 25%', 'No obstacle contact'] }),
  humanoid: defaultManifest('humanoid', 'ATLAS-H Service Humanoid', 'legged', { totalMassKg: 9.6, centerOfMass: [0, 0, .62], inertia: [1.8, 1.5, .7] }, humanoidComponents, humanoidConnections, { geometryFormat: 'urdf', geometryFile: 'atlas-h.urdf', capabilities: ['joint state', 'balance', 'vision', 'IMU', 'battery'], objective: 'Cross the workcell and stop safely if stability becomes uncertain.', passRules: ['Balance margin > 18%', 'Joint load < 92%', 'Controlled stop on fault'], joints: [{ id: 'hip', name: 'Hip pitch', type: 'revolute', parent: 'torso', child: 'leg', lower: -1.2, upper: 1.2 }] }),
  spacecraft: defaultManifest('spacecraft', 'ORBIT-1 CubeSat', 'spacecraft', { totalMassKg: 12, centerOfMass: [0, 0, 0], inertia: [.18, .2, .16] }, [battery(8.4, 12), { id: 'regulator', name: '5 V space-rated regulator', kind: 'regulator', input: { minVoltage: 6, maxVoltage: 12, currentA: .15 }, output: { voltage: 5, maxCurrentA: 3 }, pins: pins(['VIN', 'power'], ['5V', 'power'], ['GND', 'ground']) }, controller('flight-computer', 'Radiation-tolerant flight computer'), { id: 'reaction-wheel', name: 'Reaction wheel', kind: 'actuator', input: { minVoltage: 6, maxVoltage: 12, currentA: 1.8 }, pins: pins(['VBAT', 'power'], ['GND', 'ground'], ['PWM', 'pwm', { minFrequencyHz: 10, maxFrequencyHz: 20000 }]) }], [
    { id: 'wire-1', kind: 'power', from: { component: 'battery', pin: 'VBAT+' }, to: { component: 'regulator', pin: 'VIN' } },
    { id: 'wire-2', kind: 'power', from: { component: 'regulator', pin: '5V' }, to: { component: 'flight-computer', pin: '5V' } },
    { id: 'wire-3', kind: 'power', from: { component: 'battery', pin: 'VBAT+' }, to: { component: 'reaction-wheel', pin: 'VBAT' } },
    { id: 'wire-4', kind: 'signal', signal: 'pwm', frequencyHz: 1000, from: { component: 'flight-computer', pin: 'PWM1' }, to: { component: 'reaction-wheel', pin: 'PWM' } }
  ], { capabilities: ['attitude', 'orbit', 'link', 'power'], objective: 'Maintain attitude and communications through a degraded orbital segment.', passRules: ['Attitude error < 12 deg', 'Power reserve > 20%', 'Safe mode on link loss'] })
};

function makeProfile(id, family, format, accent, target, initial) {
  const manifest = manifests[id];
  return {
    id, name: manifest.name, family, format, accent, target, initial,
    capabilities: manifest.capabilities, faults: manifest.faults, objective: manifest.objective,
    passRules: manifest.passRules, manifest
  };
}

export const MACHINE_PROFILES = {
  drone: makeProfile('drone', 'Aerial', 'STEP + PX4 / MAVLink', '#5eead4', { x: 82, y: 24 }, { x: 12, y: 74, altitude: 32, heading: -20, battery: 100 }),
  rover: makeProfile('rover', 'Ground', 'SDF + ROS 2', '#60a5fa', { x: 84, y: 32 }, { x: 12, y: 72, altitude: 0, heading: -15, battery: 100 }),
  humanoid: makeProfile('humanoid', 'Legged', 'URDF + ROS 2', '#a78bfa', { x: 78, y: 54 }, { x: 18, y: 54, altitude: 0, heading: 0, battery: 100 }),
  spacecraft: makeProfile('spacecraft', 'Spacecraft', 'SDF + serial adapter', '#fb923c', { x: 82, y: 42 }, { x: 16, y: 62, altitude: 120, heading: 4, battery: 100 })
};

export const PRESET_SCENARIOS = {
  drone: [{ id: 'drone-gnss-link', name: 'GNSS drift + link loss', intent: 'Validate autonomous recovery when navigation and operator link degrade in sequence.', duration: 18, environmentId: 'himalayan', selectedTestIds: ['gnss-loss', 'command-link-loss', 'wind-gust'], events: [{ fault: 'gnss_drift', testId: 'gnss-loss', start: 3.2, duration: 6.8, severity: .72 }, { fault: 'link_loss', testId: 'command-link-loss', start: 8.1, duration: 4.2, severity: 1 }, { fault: 'wind_gust', testId: 'wind-gust', start: 11.4, duration: 3.1, severity: .58 }] }],
  rover: [{ id: 'rover-vision-slip', name: 'Occlusion + wheel slip', intent: 'Check whether the rover slows safely when perception and traction degrade together.', duration: 18, environmentId: 'urban-canyon', selectedTestIds: ['camera-occlusion', 'wheel-slip'], events: [{ fault: 'camera_occlusion', testId: 'camera-occlusion', start: 3.4, duration: 6.2, severity: .8 }, { fault: 'wheel_slip', testId: 'wheel-slip', start: 7.2, duration: 5.5, severity: .68 }] }],
  humanoid: [{ id: 'humanoid-joint-imu', name: 'Joint loss + IMU bias', intent: 'Test controlled stopping before a local actuator fault becomes a fall.', duration: 18, environmentId: 'urban-canyon', selectedTestIds: ['imu-bias', 'joint-torque-loss'], events: [{ fault: 'imu_bias', testId: 'imu-bias', start: 3.5, duration: 7.5, severity: .52 }, { fault: 'joint_torque_loss', testId: 'joint-torque-loss', start: 7, duration: 5, severity: .76 }] }],
  spacecraft: [{ id: 'spacecraft-power-link', name: 'Power + link degradation', intent: 'Exercise autonomous safe mode during a low-power communications outage.', duration: 20, environmentId: 'lunar', selectedTestIds: ['battery-sag', 'command-link-loss'], events: [{ fault: 'battery_sag', testId: 'battery-sag', start: 3, duration: 12, severity: .58 }, { fault: 'link_loss', testId: 'command-link-loss', start: 8, duration: 6, severity: 1 }] }]
};

export function cloneScenario(scenario) {
  return JSON.parse(JSON.stringify(scenario));
}

export function validateMachineManifest(value) {
  if (value?.schema === 'vidyut.machine.v2' || value?.version === 2 || value?.components) return validateV2Manifest(value);
  const errors = [];
  if (!value || typeof value !== 'object') errors.push('Manifest must be a JSON object.');
  if (!value?.id || !/^[a-z0-9-]+$/i.test(value.id)) errors.push('id must contain only letters, numbers, or hyphens.');
  if (!value?.name || typeof value.name !== 'string') errors.push('name is required.');
  if (!['aerial', 'ground', 'legged', 'spacecraft'].includes(String(value?.family || '').toLowerCase())) errors.push('family must be aerial, ground, legged, or spacecraft.');
  return { valid: errors.length === 0, ready: false, errors, issues: errors.map((message) => ({ severity: 'blocker', message })) };
}

export function profileFromManifest(input) {
  const manifest = normalizeMachineManifest(input);
  if (!manifest.name) throw new Error('Machine name is required.');
  const family = manifest.family;
  const base = family === 'aerial' ? MACHINE_PROFILES.drone : family === 'legged' ? MACHINE_PROFILES.humanoid : family === 'spacecraft' ? MACHINE_PROFILES.spacecraft : MACHINE_PROFILES.rover;
  return {
    ...JSON.parse(JSON.stringify(base)),
    id: manifest.id,
    name: manifest.name,
    family: family[0].toUpperCase() + family.slice(1),
    format: manifest.geometry?.format ? `${manifest.geometry.format.toUpperCase()} + ${manifest.interfaces?.[0]?.transport || 'custom adapter'}` : 'VIDYUT machine package',
    manifest,
    capabilities: manifest.capabilities.length ? manifest.capabilities : base.capabilities,
    faults: manifest.faults.length ? manifest.faults : testsForFamily(family).flatMap((test) => test.fault === 'multi_fault' ? [] : [test.fault]),
    objective: manifest.objective || base.objective,
    passRules: manifest.passRules.length ? manifest.passRules : base.passRules
  };
}
