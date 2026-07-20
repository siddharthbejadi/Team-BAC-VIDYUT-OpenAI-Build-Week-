export const FAULT_LIBRARY = {
  gnss_drift: { label: 'GNSS drift / loss', short: 'GNSS', description: 'Biases or removes position fixes while preserving ground truth.', color: '#f7b955' },
  link_loss: { label: 'Command-link loss', short: 'LINK', description: 'Drops operator commands and checks the autonomous fallback.', color: '#ff7a8a' },
  wind_gust: { label: 'Wind gust', short: 'WIND', description: 'Applies a repeatable lateral disturbance.', color: '#52d6c9' },
  imu_bias: { label: 'IMU bias', short: 'IMU', description: 'Adds inertial-estimation bias.', color: '#a78bfa' },
  motor_loss: { label: 'Motor degradation', short: 'MOTOR', description: 'Reduces available actuator authority.', color: '#ff7a8a' },
  battery_sag: { label: 'Battery voltage sag', short: 'POWER', description: 'Reduces available energy and peak power.', color: '#f7b955' },
  camera_occlusion: { label: 'Camera occlusion', short: 'VISION', description: 'Reduces perception confidence.', color: '#a78bfa' },
  obstacle_injection: { label: 'Unexpected obstacle', short: 'OBST', description: 'Places a hazard in the planned corridor.', color: '#fb7185' },
  low_visibility: { label: 'Low visibility', short: 'VIS', description: 'Degrades optical sensing with fog, dust, or darkness.', color: '#94a3b8' },
  precipitation: { label: 'Rain / snow', short: 'RAIN', description: 'Combines visibility, traction, and disturbance effects.', color: '#60a5fa' },
  temperature_extreme: { label: 'Temperature extreme', short: 'TEMP', description: 'Reduces battery and actuator margins.', color: '#f97316' },
  pressure_altitude: { label: 'Pressure / altitude change', short: 'ALT', description: 'Changes lift and cooling authority for aerial systems.', color: '#38bdf8' },
  emi: { label: 'Electromagnetic interference', short: 'EMI', description: 'Introduces correlated sensor and communication noise.', color: '#e879f9' },
  sensor_dropout: { label: 'Sensor dropout', short: 'SENSOR', description: 'Removes a configured sensor stream for a bounded interval.', color: '#c084fc' },
  actuator_stuck: { label: 'Actuator stuck', short: 'STUCK', description: 'Holds an actuator command at its previous value.', color: '#f43f5e' },
  power_brownout: { label: 'Power brownout', short: 'BROWN', description: 'Drops controller supply below its safe operating margin.', color: '#f59e0b' },
  latency_jitter: { label: 'Control latency / jitter', short: 'LAT', description: 'Delays controller observations and commands.', color: '#22d3ee' },
  packet_loss: { label: 'Bus packet loss', short: 'PACKET', description: 'Drops deterministic portions of the interface stream.', color: '#fb7185' },
  cpu_overload: { label: 'Compute overload', short: 'CPU', description: 'Reduces controller update capacity.', color: '#f97316' },
  memory_pressure: { label: 'Memory pressure', short: 'MEM', description: 'Models degraded planning and logging under resource pressure.', color: '#facc15' },
  waypoint_reroute: { label: 'Waypoint reroute', short: 'ROUTE', description: 'Changes the target while the machine is moving.', color: '#4ade80' },
  geofence_breach: { label: 'Geofence challenge', short: 'FENCE', description: 'Drives the plan toward a prohibited boundary.', color: '#ef4444' },
  wheel_slip: { label: 'Low-traction surface', short: 'SLIP', description: 'Reduces traction and introduces lateral drift.', color: '#f7b955' },
  joint_torque_loss: { label: 'Joint torque loss', short: 'JOINT', description: 'Reduces one leg actuator\'s authority.', color: '#ff7a8a' },
  multi_fault: { label: 'Multi-fault cascade', short: 'CASCADE', description: 'Runs a family-specific sequence of interacting failures.', color: '#f472b6' }
};

const all = ['aerial', 'ground', 'legged', 'spacecraft'];

export const TEST_LIBRARY = [
  ['gnss-loss', 'GNSS loss and drift', 'Navigation', 'gnss_drift', ['aerial', 'ground', 'spacecraft'], 0.72, 6, 'Peak position-estimate error is recorded'],
  ['command-link-loss', 'Command-link loss', 'Communications', 'link_loss', all, 1, 5, 'Safe autonomous fallback is recorded'],
  ['wind-gust', 'Cross-wind gust', 'Environment', 'wind_gust', ['aerial', 'spacecraft'], 0.62, 4, 'Attitude and recovery remain measurable'],
  ['imu-bias', 'IMU bias and drift', 'Sensors', 'imu_bias', all, 0.58, 6, 'State-estimate divergence is recorded'],
  ['motor-degradation', 'Motor / actuator degradation', 'Actuation', 'motor_loss', ['aerial', 'ground', 'spacecraft'], 0.64, 5, 'Remaining control authority is measured'],
  ['battery-sag', 'Battery voltage sag', 'Power', 'battery_sag', all, 0.56, 8, 'Power reserve stays observable'],
  ['camera-occlusion', 'Camera occlusion', 'Sensors', 'camera_occlusion', all, 0.76, 6, 'Perception fallback is exercised'],
  ['unexpected-obstacle', 'Unexpected obstacle', 'Mission', 'obstacle_injection', ['aerial', 'ground', 'legged'], 0.68, 4, 'Collision avoidance response is recorded'],
  ['low-visibility', 'Low visibility', 'Environment', 'low_visibility', all, 0.7, 7, 'Perception confidence and response are recorded'],
  ['rain-snow', 'Rain or snow exposure', 'Environment', 'precipitation', ['aerial', 'ground', 'legged'], 0.6, 7, 'Combined visibility and motion effects are measured'],
  ['temperature-extreme', 'Temperature extreme', 'Environment', 'temperature_extreme', all, 0.58, 9, 'Energy and actuator derating are recorded'],
  ['pressure-altitude', 'Pressure and altitude shift', 'Environment', 'pressure_altitude', ['aerial', 'spacecraft'], 0.65, 7, 'Lift or attitude margin is measured'],
  ['emi', 'Electromagnetic interference', 'Electrical', 'emi', all, 0.62, 5, 'Correlated sensor and link degradation is recorded'],
  ['sensor-dropout', 'Primary sensor dropout', 'Sensors', 'sensor_dropout', all, 0.8, 5, 'Redundant sensing or safe stop is exercised'],
  ['actuator-stuck', 'Actuator stuck command', 'Actuation', 'actuator_stuck', all, 0.7, 5, 'Controller compensation is recorded'],
  ['power-brownout', 'Controller power brownout', 'Power', 'power_brownout', all, 0.66, 4, 'Controller reset or degraded behavior is recorded'],
  ['latency-jitter', 'Control-loop latency and jitter', 'Compute', 'latency_jitter', all, 0.58, 7, 'Stability under delayed I/O is measured'],
  ['packet-loss', 'Interface packet loss', 'Communications', 'packet_loss', all, 0.65, 6, 'Dropped-data tolerance is measured'],
  ['cpu-overload', 'Controller compute overload', 'Compute', 'cpu_overload', all, 0.72, 6, 'Update-rate degradation is recorded'],
  ['memory-pressure', 'Controller memory pressure', 'Compute', 'memory_pressure', all, 0.55, 7, 'Planning degradation is recorded'],
  ['waypoint-reroute', 'Dynamic waypoint reroute', 'Mission', 'waypoint_reroute', ['aerial', 'ground', 'spacecraft'], 0.5, 5, 'Route change response is recorded'],
  ['geofence', 'Geofence boundary challenge', 'Mission', 'geofence_breach', ['aerial', 'ground', 'spacecraft'], 0.7, 5, 'Boundary handling is recorded'],
  ['wheel-slip', 'Wheel slip / low traction', 'Actuation', 'wheel_slip', ['ground'], 0.7, 6, 'Traction control response is recorded'],
  ['joint-torque-loss', 'Joint torque loss', 'Actuation', 'joint_torque_loss', ['legged'], 0.72, 5, 'Balance and controlled-stop response are recorded'],
  ['multi-fault-cascade', 'Multi-fault cascade', 'Combined', 'multi_fault', all, 0.7, 12, 'Interaction and recovery across multiple faults are recorded']
].map(([id, name, category, fault, appliesTo, defaultSeverity, duration, assertion]) => ({
  id, name, category, fault, appliesTo, defaultSeverity, duration, assertion,
  description: FAULT_LIBRARY[fault].description
}));

export const ENVIRONMENTS = [
  { id: 'himalayan', name: 'Himalayan range', body: 'Earth', terrain: 'Mountain ridges and deep valleys', gravity: 9.80665, airDensity: 0.82, temperature: -8, wind: 12, visibility: 72, latitude: 27.9881, longitude: 86.925, elevation: 4200, color: '#7dd3fc' },
  { id: 'urban-canyon', name: 'Dense urban canyon', body: 'Earth', terrain: 'Buildings, alleys, reflective surfaces', gravity: 9.80665, airDensity: 1.19, temperature: 24, wind: 7, visibility: 80, latitude: 51.5074, longitude: -0.1278, elevation: 28, color: '#94a3b8' },
  { id: 'desert', name: 'Hot desert range', body: 'Earth', terrain: 'Sand, dust, dunes and thermal load', gravity: 9.80665, airDensity: 1.12, temperature: 46, wind: 9, visibility: 58, latitude: 24.4539, longitude: 54.3773, elevation: 120, color: '#fbbf24' },
  { id: 'arctic', name: 'Arctic field', body: 'Earth', terrain: 'Ice, snow and low-contrast horizon', gravity: 9.80665, airDensity: 1.34, temperature: -32, wind: 15, visibility: 52, latitude: 78.2232, longitude: 15.6469, elevation: 40, color: '#bae6fd' },
  { id: 'rainforest', name: 'Rainforest corridor', body: 'Earth', terrain: 'Canopy, humidity and uneven ground', gravity: 9.80665, airDensity: 1.16, temperature: 31, wind: 5, visibility: 46, latitude: -3.4653, longitude: -62.2159, elevation: 85, color: '#4ade80' },
  { id: 'lunar', name: 'Lunar south pole', body: 'Moon', terrain: 'Regolith, craters and hard shadows', gravity: 1.62, airDensity: 0, temperature: -90, wind: 0, visibility: 76, latitude: -89.5, longitude: 0, elevation: -2800, color: '#d1d5db' },
  { id: 'mars', name: 'Mars crater rim', body: 'Mars', terrain: 'Rock, regolith and dust', gravity: 3.721, airDensity: 0.02, temperature: -55, wind: 18, visibility: 61, latitude: -4.5, longitude: 137.4, elevation: -4500, color: '#fb923c' }
];

export function testsForFamily(family) {
  const key = String(family || '').toLowerCase();
  return TEST_LIBRARY.filter((test) => test.appliesTo.includes(key));
}

export function scenarioFromTests(profile, tests, options = {}) {
  const selected = tests.length ? tests : testsForFamily(profile.family).slice(0, 2);
  const events = [];
  let cursor = 3;
  for (const test of selected) {
    if (test.fault === 'multi_fault') {
      const cascade = profile.family.toLowerCase() === 'aerial'
        ? ['wind_gust', 'gnss_drift', 'link_loss']
        : profile.family.toLowerCase() === 'legged'
          ? ['imu_bias', 'joint_torque_loss', 'battery_sag']
          : ['camera_occlusion', 'wheel_slip', 'link_loss'];
      cascade.filter((fault) => profile.faults.includes(fault)).forEach((fault, index) => {
        events.push({ fault, testId: test.id, start: cursor + index * 2.7, duration: 4.2, severity: Math.max(.3, test.defaultSeverity - index * .08) });
      });
      cursor += 9;
    } else if (profile.faults.includes(test.fault)) {
      events.push({ fault: test.fault, testId: test.id, start: cursor, duration: test.duration, severity: test.defaultSeverity });
      cursor += Math.max(3.2, test.duration * .58);
    }
  }
  const duration = Math.min(60, Math.max(15, cursor + 5));
  return {
    id: `scenario-${profile.id}-${Date.now()}`,
    name: options.name || `${selected.length} test validation plan`,
    intent: options.intent || `Exercise ${profile.name} against ${selected.map((test) => test.name).join(', ')}.`,
    duration,
    environmentId: options.environmentId || 'himalayan',
    selectedTestIds: selected.map((test) => test.id),
    events: events.map((event) => ({ ...event, start: Math.min(event.start, duration - event.duration) }))
  };
}
