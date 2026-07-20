const clone = (value) => JSON.parse(JSON.stringify(value));
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const slug = (value, fallback = 'custom-machine') => String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;

export const MANIFEST_SCHEMA = 'vidyut.machine.v2';

export function createStarterManifest(overrides = {}) {
  const id = slug(overrides.id || overrides.name);
  return {
    schema: MANIFEST_SCHEMA,
    version: 2,
    id,
    name: overrides.name || 'Untitled machine',
    family: String(overrides.family || 'aerial').toLowerCase(),
    description: overrides.description || '',
    identity: clone(overrides.identity || { manufacturer: '', owner: '', revision: '1', sourceHashes: [] }),
    sourceFiles: [],
    geometry: {
      format: overrides.geometry?.format || 'primitive',
      fileName: overrides.geometry?.fileName || null,
      units: overrides.geometry?.units || 'm',
      links: overrides.geometry?.links || [{ id: 'body', name: 'Main body', massKg: 1.2, centerOfMass: [0, 0, 0], inertia: [0.02, 0.02, 0.03], collision: 'box' }],
      joints: overrides.geometry?.joints || [],
      preview: overrides.geometry?.preview || null,
      coordinateFrame: overrides.geometry?.coordinateFrame || 'unspecified',
      confirmed: overrides.geometry?.confirmed ?? true
    },
    physical: {
      totalMassKg: overrides.physical?.totalMassKg ?? 1.2,
      centerOfMass: overrides.physical?.centerOfMass || [0, 0, 0],
      gravityEnabled: overrides.physical?.gravityEnabled ?? true,
      frictionCoefficient: overrides.physical?.frictionCoefficient ?? 0.65,
      dragCoefficient: overrides.physical?.dragCoefficient ?? 0.9,
      confirmed: overrides.physical?.confirmed ?? true
    },
    components: clone(overrides.components || []),
    connections: clone(overrides.connections || []),
    interfaces: clone(overrides.interfaces || [{ id: 'controller-json', transport: 'web-serial', baudRate: 115200, protocol: 'vidyut.hil.v1', benchSafe: true }]),
    safety: clone(overrides.safety || { physicalActuatorsDisabled: true, emergencyStopRequired: true, watchdogMs: 750, benchChecklistConfirmed: false }),
    provenance: clone(overrides.provenance || []),
    capabilities: clone(overrides.capabilities || []),
    faults: clone(overrides.faults || []),
    objective: overrides.objective || 'Complete the mission while recording controller response to injected failures.',
    passRules: clone(overrides.passRules || []),
    assumptions: clone(overrides.assumptions || []),
    confirmations: clone(overrides.confirmations || [])
  };
}

export function normalizeMachineManifest(raw = {}) {
  if (raw.schema === MANIFEST_SCHEMA || raw.version === 2) {
    const base = createStarterManifest({ ...raw, geometry: raw.geometry, physical: raw.physical });
    return {
      ...base,
      ...clone(raw),
      schema: MANIFEST_SCHEMA,
      version: 2,
      id: slug(raw.id || raw.name),
      family: String(raw.family || 'aerial').toLowerCase(),
      geometry: { ...base.geometry, ...(raw.geometry || {}) },
      physical: { ...base.physical, ...(raw.physical || {}) },
      components: Array.isArray(raw.components) ? clone(raw.components) : [],
      connections: Array.isArray(raw.connections) ? clone(raw.connections) : [],
      interfaces: Array.isArray(raw.interfaces) ? clone(raw.interfaces) : base.interfaces,
      safety: { ...base.safety, ...(raw.safety || {}) },
      identity: { ...base.identity, ...(raw.identity || {}) },
      provenance: Array.isArray(raw.provenance) ? clone(raw.provenance) : []
    };
  }
  return createStarterManifest({
    ...raw,
    family: raw.family || 'aerial',
    geometry: raw.geometry || { confirmed: false },
    physical: raw.physical || { confirmed: false },
    assumptions: [...(raw.assumptions || []), 'Imported from a VIDYUT v1 profile; physical and electrical properties require confirmation.']
  });
}

function issue(severity, code, path, message, suggestion = '') {
  return { severity, code, path, message, suggestion };
}

function pin(component, pinId) {
  return (component?.pins || []).find((item) => item.id === pinId || item.name === pinId);
}

function voltageRange(component, direction) {
  const source = direction === 'output' ? component.output : component.input;
  if (!source) return null;
  const nominal = number(source.voltage, number(source.nominalVoltage));
  return {
    min: number(source.minVoltage, nominal),
    max: number(source.maxVoltage, nominal),
    nominal
  };
}

export function validateMachineManifest(manifest) {
  const value = normalizeMachineManifest(manifest);
  const issues = [];
  if (!value.name?.trim()) issues.push(issue('blocker', 'NAME_REQUIRED', 'name', 'Machine name is required.'));
  if (!['aerial', 'ground', 'legged', 'spacecraft'].includes(value.family)) issues.push(issue('blocker', 'FAMILY_INVALID', 'family', 'Family must be aerial, ground, legged, or spacecraft.'));
  if (!value.geometry?.fileName && value.geometry?.format !== 'primitive') issues.push(issue('warning', 'GEOMETRY_FILE_MISSING', 'geometry.fileName', 'Geometry format is set but no source file is attached.'));
  if (!value.geometry?.confirmed) issues.push(issue('warning', 'GEOMETRY_UNCONFIRMED', 'geometry.confirmed', 'Derived geometry, joint, and collision properties have not been confirmed.'));
  if (!['m', 'mm', 'cm', 'in', 'ft'].includes(String(value.geometry?.units || '').toLowerCase())) issues.push(issue('warning', 'GEOMETRY_UNITS_UNCONFIRMED', 'geometry.units', 'Geometry units are missing or ambiguous; confirm scale before execution.'));
  if (!(value.geometry?.links || []).length) issues.push(issue('blocker', 'GEOMETRY_LINKS_REQUIRED', 'geometry.links', 'At least one rigid link or body is required for execution.'));
  const linkIds = new Set();
  for (const [index, link] of (value.geometry?.links || []).entries()) {
    const path = `geometry.links[${index}]`;
    if (!link.id) issues.push(issue('blocker', 'LINK_ID_REQUIRED', `${path}.id`, 'Every rigid link needs a stable ID.'));
    else if (linkIds.has(link.id)) issues.push(issue('blocker', 'LINK_ID_DUPLICATE', `${path}.id`, `Rigid-link ID ${link.id} is duplicated.`));
    else linkIds.add(link.id);
    if (!(number(link.massKg, 0) > 0)) issues.push(issue('warning', 'LINK_MASS_MISSING', `${path}.massKg`, `${link.name || link.id || `Link ${index + 1}`} has no confirmed positive mass.`));
    if (!Array.isArray(link.inertia) || link.inertia.length < 3 || link.inertia.some((item) => !(number(item, 0) > 0))) issues.push(issue('warning', 'LINK_INERTIA_INCOMPLETE', `${path}.inertia`, `${link.name || link.id || `Link ${index + 1}`} needs positive principal inertia values.`));
    if (!link.collision || link.collision === 'unspecified' || link.collision === 'derive-in-backend') issues.push(issue('warning', 'COLLISION_UNCONFIRMED', `${path}.collision`, `${link.name || link.id || `Link ${index + 1}`} has no confirmed collision representation.`));
  }
  for (const [index, joint] of (value.geometry?.joints || []).entries()) {
    const path = `geometry.joints[${index}]`;
    if (joint.parent && !linkIds.has(slug(joint.parent))) issues.push(issue('warning', 'JOINT_PARENT_UNKNOWN', `${path}.parent`, `Joint ${joint.name || joint.id} references undeclared parent ${joint.parent}.`));
    if (joint.child && !linkIds.has(slug(joint.child))) issues.push(issue('warning', 'JOINT_CHILD_UNKNOWN', `${path}.child`, `Joint ${joint.name || joint.id} references undeclared child ${joint.child}.`));
    if (['revolute', 'prismatic', 'continuous'].includes(joint.type) && (!Array.isArray(joint.axis) || joint.axis.length !== 3)) issues.push(issue('warning', 'JOINT_AXIS_MISSING', `${path}.axis`, `Moving joint ${joint.name || joint.id} needs a three-axis definition.`));
  }
  if (!(number(value.physical?.totalMassKg, 0) > 0)) issues.push(issue('blocker', 'MASS_REQUIRED', 'physical.totalMassKg', 'A positive total mass is required for execution.'));
  if (!value.physical?.confirmed) issues.push(issue('warning', 'PHYSICS_UNCONFIRMED', 'physical.confirmed', 'Mass, centre of mass, inertia, friction, or drag still require engineering confirmation.'));
  if (!Array.isArray(value.physical?.centerOfMass) || value.physical.centerOfMass.length !== 3 || value.physical.centerOfMass.some((item) => !Number.isFinite(Number(item)))) issues.push(issue('blocker', 'CENTER_OF_MASS_INVALID', 'physical.centerOfMass', 'Centre of mass must contain three finite values.'));
  const declaredLinkMass = (value.geometry?.links || []).reduce((sum, link) => sum + Math.max(0, number(link.massKg, 0)), 0);
  if (declaredLinkMass > 0 && number(value.physical?.totalMassKg, 0) > 0 && Math.abs(declaredLinkMass - value.physical.totalMassKg) / value.physical.totalMassKg > .05) issues.push(issue('warning', 'MASS_SUM_MISMATCH', 'physical.totalMassKg', `Link masses total ${declaredLinkMass.toFixed(3)} kg but machine mass is ${Number(value.physical.totalMassKg).toFixed(3)} kg.`));

  const components = new Map();
  for (const [index, component] of value.components.entries()) {
    const path = `components[${index}]`;
    if (!component.id) issues.push(issue('blocker', 'COMPONENT_ID_REQUIRED', `${path}.id`, 'Every component needs a stable ID.'));
    else if (components.has(component.id)) issues.push(issue('blocker', 'COMPONENT_ID_DUPLICATE', `${path}.id`, `Component ID ${component.id} is duplicated.`));
    else components.set(component.id, component);
    if (!component.name && !component.partNumber) issues.push(issue('warning', 'COMPONENT_NAME_MISSING', `${path}.name`, 'Add a component name or part number.'));
    if (component.confirmed === false) issues.push(issue('warning', 'COMPONENT_UNCONFIRMED', `${path}.confirmed`, `${component.name || component.id} was researched or inferred and still requires engineer confirmation against its source.`));
    if (component.kind === 'controller' && !(component.pins || []).length) issues.push(issue('warning', 'CONTROLLER_PINOUT_MISSING', `${path}.pins`, 'Controller pin definitions are missing; signal validation is limited.'));
    const pinIds = new Set();
    for (const [pinIndex, declaredPin] of (component.pins || []).entries()) {
      if (!declaredPin.id) issues.push(issue('blocker', 'PIN_ID_REQUIRED', `${path}.pins[${pinIndex}].id`, `Every pin on ${component.id || path} needs an ID.`));
      else if (pinIds.has(declaredPin.id)) issues.push(issue('blocker', 'PIN_ID_DUPLICATE', `${path}.pins[${pinIndex}].id`, `${component.id}.${declaredPin.id} is duplicated.`));
      else pinIds.add(declaredPin.id);
    }
    if (component.input && number(component.input.minVoltage) != null && number(component.input.maxVoltage) != null && number(component.input.minVoltage) > number(component.input.maxVoltage)) issues.push(issue('blocker', 'VOLTAGE_RANGE_INVALID', `${path}.input`, `${component.id} has an inverted input-voltage range.`));
    if (component.confirmed !== true && !component.sourceUrl && !(component.provenance || []).length) issues.push(issue('warning', 'COMPONENT_PROVENANCE_MISSING', path, `${component.name || component.id} needs a manufacturer source or provenance record before inferred fields are trusted.`));
  }
  if (value.components.length === 0) issues.push(issue('blocker', 'COMPONENTS_REQUIRED', 'components', 'Add the controller, power source, sensors, and actuators before testing.'));

  const drivenInputs = new Map();
  const poweredSinks = new Set();
  const spiSelectSources = new Map();
  const uartLinks = [];
  for (const [index, connection] of value.connections.entries()) {
    const path = `connections[${index}]`;
    const from = components.get(connection.from?.component);
    const to = components.get(connection.to?.component);
    if (!from) issues.push(issue('blocker', 'SOURCE_COMPONENT_UNKNOWN', `${path}.from`, `Source component ${connection.from?.component || '(missing)'} does not exist.`));
    if (!to) issues.push(issue('blocker', 'TARGET_COMPONENT_UNKNOWN', `${path}.to`, `Target component ${connection.to?.component || '(missing)'} does not exist.`));
    if (!from || !to) continue;
    const fromPin = pin(from, connection.from?.pin);
    const toPin = pin(to, connection.to?.pin);
    if ((from.pins || []).length && !fromPin) issues.push(issue('blocker', 'SOURCE_PIN_UNKNOWN', `${path}.from.pin`, `Pin ${connection.from?.pin} is not declared on ${from.id}.`));
    if ((to.pins || []).length && !toPin) issues.push(issue('blocker', 'TARGET_PIN_UNKNOWN', `${path}.to.pin`, `Pin ${connection.to?.pin} is not declared on ${to.id}.`));

    const targetKey = `${to.id}.${connection.to?.pin}`;
    if (connection.kind !== 'ground' && drivenInputs.has(targetKey)) issues.push(issue('blocker', 'PIN_DRIVEN_TWICE', path, `${targetKey} is driven by more than one connection.`));
    else drivenInputs.set(targetKey, path);

    if (connection.kind === 'power') {
      poweredSinks.add(to.id);
      const sourceRange = voltageRange(from, 'output');
      const targetRange = voltageRange(to, 'input');
      if (sourceRange?.nominal != null && targetRange?.min != null && (sourceRange.nominal < targetRange.min || sourceRange.nominal > targetRange.max)) {
        issues.push(issue('blocker', 'VOLTAGE_INCOMPATIBLE', path, `${from.id} supplies ${sourceRange.nominal} V but ${to.id} accepts ${targetRange.min}-${targetRange.max} V.`));
      }
      const fromGround = /gnd|ground|-/i.test(String(connection.from?.pin));
      const toPositive = /vcc|vin|vbat|\+|power/i.test(String(connection.to?.pin));
      if (fromGround && toPositive) issues.push(issue('blocker', 'REVERSE_POLARITY', path, 'Ground is connected to a positive supply input.'));
    }
    if (connection.kind === 'signal') {
      const fromMode = String(fromPin?.mode || connection.signal || '').toLowerCase();
      const toMode = String(toPin?.mode || connection.signal || '').toLowerCase();
      if (fromMode === 'tx' && toMode === 'tx') issues.push(issue('blocker', 'UART_TX_TO_TX', path, 'UART TX must connect to RX, not TX.'));
      if (fromMode === 'rx' && toMode === 'rx') issues.push(issue('blocker', 'UART_RX_TO_RX', path, 'UART RX must connect to TX, not RX.'));
      if (connection.signal === 'pwm') {
        const frequency = number(connection.frequencyHz);
        const min = number(toPin?.minFrequencyHz, 1);
        const max = number(toPin?.maxFrequencyHz, 100000);
        if (frequency != null && (frequency < min || frequency > max)) issues.push(issue('blocker', 'PWM_FREQUENCY_INVALID', path, `PWM ${frequency} Hz is outside ${to.id}'s ${min}-${max} Hz range.`));
      }
      if (/spi[-_ ]?cs|chip[-_ ]?select|cs/i.test(String(connection.signal || connection.net || ''))) {
        const sourceKey = `${from.id}.${connection.from?.pin}`;
        if (spiSelectSources.has(sourceKey)) issues.push(issue('blocker', 'SPI_CHIP_SELECT_REUSED', path, `${sourceKey} selects both ${spiSelectSources.get(sourceKey)} and ${to.id}; each SPI target needs an independent chip-select.`));
        else spiSelectSources.set(sourceKey, to.id);
      }
      if (/uart/i.test(String(connection.signal || '')) || ['tx', 'rx'].includes(fromMode) || ['tx', 'rx'].includes(toMode)) uartLinks.push({ connection, from, to, path });
    }
  }

  for (const { connection, from, to, path } of uartLinks) {
    const rates = [connection.baudRate, from.baudRate, to.baudRate].map((item) => number(item)).filter((item) => item != null);
    if (new Set(rates).size > 1) issues.push(issue('blocker', 'UART_BAUD_MISMATCH', path, `${from.id} and ${to.id} declare incompatible UART baud rates (${[...new Set(rates)].join(', ')}).`));
  }

  const demand = value.components.filter((component) => component.kind !== 'power-source').reduce((sum, component) => sum + Math.max(0, number(component.input?.currentA, 0)), 0);
  const capacity = value.components.filter((component) => component.kind === 'power-source').reduce((sum, component) => sum + Math.max(0, number(component.output?.maxCurrentA, 0)), 0);
  if (demand > 0 && capacity > 0 && demand > capacity) issues.push(issue('blocker', 'POWER_BUDGET_EXCEEDED', 'components', `Peak declared load is ${demand.toFixed(2)} A but source capacity is ${capacity.toFixed(2)} A.`));
  if (demand > 0 && capacity > 0 && demand > capacity * .8 && demand <= capacity) issues.push(issue('warning', 'POWER_MARGIN_LOW', 'components', `Peak load uses ${Math.round(demand / capacity * 100)}% of declared source capacity.`));

  for (const component of value.components) {
    if (component.kind !== 'power-source' && component.input && !poweredSinks.has(component.id)) issues.push(issue('blocker', 'COMPONENT_UNPOWERED', `components.${component.id}`, `${component.name || component.id} declares a power input but has no power connection.`));
  }
  const addresses = new Map();
  for (const component of value.components.filter((item) => String(item.bus || '').toLowerCase() === 'i2c' && item.address)) {
    const key = `${String(component.busId || 'i2c-0').toLowerCase()}:${String(component.address).toLowerCase()}`;
    if (addresses.has(key)) issues.push(issue('blocker', 'I2C_ADDRESS_CONFLICT', `components.${component.id}.address`, `${component.id} and ${addresses.get(key)} share I2C address ${component.address}.`));
    else addresses.set(key, component.id);
  }
  const canGroups = new Map();
  for (const component of value.components.filter((item) => String(item.bus || '').toLowerCase() === 'can')) {
    const busId = String(component.busId || 'can-0').toLowerCase();
    if (!canGroups.has(busId)) canGroups.set(busId, []);
    canGroups.get(busId).push(component);
  }
  for (const [busId, members] of canGroups) {
    const identifiers = new Map();
    for (const component of members) {
      if (component.canId != null) {
        const canId = String(component.canId).toLowerCase();
        if (identifiers.has(canId)) issues.push(issue('blocker', 'CAN_ID_CONFLICT', `components.${component.id}.canId`, `${component.id} and ${identifiers.get(canId)} share CAN identifier ${component.canId} on ${busId}.`));
        else identifiers.set(canId, component.id);
      }
    }
    const terminations = members.filter((component) => component.canTermination === true).length;
    if (members.length > 1 && terminations !== 2) issues.push(issue('warning', 'CAN_TERMINATION_UNCONFIRMED', `components.${busId}`, `${busId} declares ${terminations} terminated nodes; a conventional linear CAN bus normally needs two endpoint terminations.`));
  }
  if (!value.interfaces.length) issues.push(issue('warning', 'CONTROLLER_INTERFACE_MISSING', 'interfaces', 'No SIL/HIL controller interface is configured.'));
  for (const [index, controllerInterface] of value.interfaces.entries()) {
    const path = `interfaces[${index}]`;
    if (controllerInterface.transport === 'web-serial' && !(number(controllerInterface.baudRate, 0) > 0)) issues.push(issue('blocker', 'INTERFACE_BAUD_REQUIRED', `${path}.baudRate`, 'Web Serial interfaces require a positive baud rate.'));
    if (controllerInterface.benchSafe !== true) issues.push(issue('blocker', 'INTERFACE_BENCH_SAFETY_REQUIRED', `${path}.benchSafe`, 'HIL interfaces must explicitly enable bench-safe mode.'));
    for (const channel of [...(controllerInterface.inputs || []), ...(controllerInterface.outputs || [])]) if (!channel.mapping && !channel.component && !channel.topic) issues.push(issue('warning', 'CONTROLLER_CHANNEL_UNMAPPED', path, `Controller channel ${channel.name || '(unnamed)'} has no component, topic, or mapping.`));
  }
  if (value.safety?.physicalActuatorsDisabled !== true) issues.push(issue('blocker', 'PHYSICAL_OUTPUTS_NOT_DISABLED', 'safety.physicalActuatorsDisabled', 'Controller-level HIL requires physical actuator outputs to remain disabled.'));
  if (value.safety?.emergencyStopRequired !== true) issues.push(issue('blocker', 'EMERGENCY_STOP_REQUIRED', 'safety.emergencyStopRequired', 'Declare an emergency-stop requirement before HIL execution.'));

  const blockers = issues.filter((item) => item.severity === 'blocker');
  const warnings = issues.filter((item) => item.severity === 'warning');
  return {
    valid: blockers.length === 0,
    ready: blockers.length === 0,
    issues,
    summary: { blockers: blockers.length, warnings: warnings.length, checks: 18, components: value.components.length, connections: value.connections.length, powerDemandA: Number(demand.toFixed(3)), powerCapacityA: Number(capacity.toFixed(3)) }
  };
}

function attributes(source = '') {
  const result = {};
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) result[match[1]] = match[2];
  return result;
}

function xyz(value) {
  return String(value || '0 0 0').trim().split(/\s+/).slice(0, 3).map((item) => number(item, 0));
}

export function parseUrdf(text, fileName = 'machine.urdf') {
  const robot = attributes(text.match(/<robot\b([^>]*)>/i)?.[1]).name || fileName.replace(/\.[^.]+$/, '');
  const links = [];
  for (const match of text.matchAll(/<link\b([^>]*)>([\s\S]*?)<\/link>/gi)) {
    const attr = attributes(match[1]);
    const body = match[2];
    const mass = attributes(body.match(/<mass\b([^>]*)\/?\s*>/i)?.[1]).value;
    const origin = attributes(body.match(/<inertial[\s\S]*?<origin\b([^>]*)\/?\s*>/i)?.[1]).xyz;
    const inertia = attributes(body.match(/<inertia\b([^>]*)\/?\s*>/i)?.[1]);
    const inertialRpy = attributes(body.match(/<inertial[\s\S]*?<origin\b([^>]*)\/?\s*>/i)?.[1]).rpy;
    const visualMesh = attributes(body.match(/<visual[\s\S]*?<mesh\b([^>]*)\/?\s*>/i)?.[1]).filename;
    const collisionMesh = attributes(body.match(/<collision[\s\S]*?<mesh\b([^>]*)\/?\s*>/i)?.[1]).filename;
    const collision = /<mesh\b/i.test(body) ? 'mesh' : /<cylinder\b/i.test(body) ? 'cylinder' : /<sphere\b/i.test(body) ? 'sphere' : /<box\b/i.test(body) ? 'box' : 'unspecified';
    links.push({ id: slug(attr.name, `link-${links.length + 1}`), name: attr.name || `Link ${links.length + 1}`, massKg: number(mass), centerOfMass: xyz(origin), inertialOrientationRpy: xyz(inertialRpy), inertia: [number(inertia.ixx), number(inertia.iyy), number(inertia.izz)], inertiaTensor: { ixx: number(inertia.ixx), ixy: number(inertia.ixy), ixz: number(inertia.ixz), iyy: number(inertia.iyy), iyz: number(inertia.iyz), izz: number(inertia.izz) }, visualMesh: visualMesh || null, collisionMesh: collisionMesh || null, collision });
  }
  const joints = [];
  for (const match of text.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi)) {
    const attr = attributes(match[1]);
    const body = match[2];
    const parent = attributes(body.match(/<parent\b([^>]*)\/?\s*>/i)?.[1]).link;
    const child = attributes(body.match(/<child\b([^>]*)\/?\s*>/i)?.[1]).link;
    const limit = attributes(body.match(/<limit\b([^>]*)\/?\s*>/i)?.[1]);
    const axis = attributes(body.match(/<axis\b([^>]*)\/?\s*>/i)?.[1]).xyz;
    const jointOrigin = attributes(body.match(/<origin\b([^>]*)\/?\s*>/i)?.[1]);
    joints.push({ id: slug(attr.name, `joint-${joints.length + 1}`), name: attr.name, type: attr.type || 'fixed', parent, child, axis: xyz(axis || (attr.type === 'fixed' ? '0 0 0' : '1 0 0')), origin: xyz(jointOrigin.xyz), orientationRpy: xyz(jointOrigin.rpy), lower: number(limit.lower), upper: number(limit.upper), effort: number(limit.effort), velocity: number(limit.velocity) });
  }
  const transmissions = [...text.matchAll(/<transmission\b([^>]*)>([\s\S]*?)<\/transmission>/gi)].map((match, index) => {
    const body = match[2];
    return { id: slug(attributes(match[1]).name, `transmission-${index + 1}`), joint: attributes(body.match(/<joint\b([^>]*)>/i)?.[1]).name || null, actuator: attributes(body.match(/<actuator\b([^>]*)>/i)?.[1]).name || null, type: body.match(/<type>\s*([^<]+)/i)?.[1]?.trim() || null };
  });
  const sensors = [...text.matchAll(/<sensor\b([^>]*)>([\s\S]*?)<\/sensor>/gi)].map((match, index) => ({ id: slug(attributes(match[1]).name, `sensor-${index + 1}`), name: attributes(match[1]).name || `Sensor ${index + 1}`, type: attributes(match[1]).type || 'unspecified' }));
  const masses = links.map((link) => link.massKg).filter(Number.isFinite);
  const format = fileName.toLowerCase().endsWith('.xacro') ? 'xacro' : 'urdf';
  const xacroWarning = format === 'xacro' && /<xacro:|\$\{|\$\(/i.test(text) ? ' Xacro macros remain unresolved; export expanded URDF for authoritative execution.' : '';
  return { name: robot, geometry: { format, fileName, units: 'm', links, joints, transmissions, sensors, coordinateFrame: 'source-defined', confirmed: false }, physical: { totalMassKg: masses.length === links.length && links.length ? masses.reduce((sum, mass) => sum + mass, 0) : null, confirmed: false }, assumptions: [`${format.toUpperCase()} geometry, meshes, collisions, joints, inertial fields, transmissions, and declared sensors were parsed; validate referenced assets, coordinate frames, and every inferred property.${xacroWarning}`] };
}

export function parseSdf(text, fileName = 'machine.sdf') {
  const model = attributes(text.match(/<model\b([^>]*)>/i)?.[1]).name || fileName.replace(/\.[^.]+$/, '');
  const links = [];
  for (const match of text.matchAll(/<link\b([^>]*)>([\s\S]*?)<\/link>/gi)) {
    const attr = attributes(match[1]);
    const body = match[2];
    const mass = body.match(/<mass>\s*([^<]+)\s*<\/mass>/i)?.[1];
    const pose = body.match(/<inertial[\s\S]*?<pose>\s*([^<]+)\s*<\/pose>/i)?.[1];
    const inertia = {};
    for (const key of ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz']) inertia[key] = number(body.match(new RegExp(`<${key}>\\s*([^<]+)`, 'i'))?.[1]);
    const sensors = [...body.matchAll(/<sensor\b([^>]*)>/gi)].map((sensor) => ({ name: attributes(sensor[1]).name || null, type: attributes(sensor[1]).type || 'unspecified' }));
    const visualMesh = body.match(/<visual[\s\S]*?<uri>\s*([^<]+)/i)?.[1]?.trim() || null;
    const collisionMesh = body.match(/<collision[\s\S]*?<uri>\s*([^<]+)/i)?.[1]?.trim() || null;
    links.push({ id: slug(attr.name, `link-${links.length + 1}`), name: attr.name, massKg: number(mass), centerOfMass: xyz(pose), inertialOrientationRpy: String(pose || '').trim().split(/\s+/).slice(3, 6).map((item) => number(item, 0)), inertia: [inertia.ixx, inertia.iyy, inertia.izz], inertiaTensor: inertia, sensors, visualMesh, collisionMesh, collision: /<collision[\s\S]*?<mesh\b/i.test(body) ? 'mesh' : /<collision\b/i.test(body) ? 'primitive' : 'unspecified' });
  }
  const joints = [];
  for (const match of text.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi)) {
    const attr = attributes(match[1]);
    const body = match[2];
    const lower = body.match(/<lower>\s*([^<]+)/i)?.[1];
    const upper = body.match(/<upper>\s*([^<]+)/i)?.[1];
    const effort = body.match(/<effort>\s*([^<]+)/i)?.[1];
    const velocity = body.match(/<velocity>\s*([^<]+)/i)?.[1];
    const axis = body.match(/<axis[\s\S]*?<xyz[^>]*>\s*([^<]+)/i)?.[1];
    joints.push({ id: slug(attr.name, `joint-${joints.length + 1}`), name: attr.name, type: attr.type || 'fixed', parent: body.match(/<parent>\s*([^<]+)/i)?.[1]?.trim(), child: body.match(/<child>\s*([^<]+)/i)?.[1]?.trim(), axis: xyz(axis || (attr.type === 'fixed' ? '0 0 0' : '1 0 0')), lower: number(lower), upper: number(upper), effort: number(effort), velocity: number(velocity) });
  }
  const plugins = [...text.matchAll(/<plugin\b([^>]*)>/gi)].map((match) => ({ name: attributes(match[1]).name || null, fileName: attributes(match[1]).filename || null }));
  const masses = links.map((link) => link.massKg).filter(Number.isFinite);
  return { name: model, geometry: { format: 'sdf', fileName, units: 'm', links, joints, plugins, coordinateFrame: 'source-defined', confirmed: false }, physical: { totalMassKg: masses.length === links.length && links.length ? masses.reduce((sum, mass) => sum + mass, 0) : null, confirmed: false }, assumptions: ['SDF links, joints, inertial tensors, sensor declarations, plugins, and referenced meshes were parsed; referenced assets and backend coefficients must be confirmed in the execution backend.'] };
}

export function parseStep(text, fileName = 'machine.step') {
  const name = text.match(/FILE_NAME\s*\(\s*'([^']*)'/i)?.[1] || text.match(/PRODUCT\s*\(\s*'([^']+)'/i)?.[1] || fileName.replace(/\.[^.]+$/, '');
  const units = /SI_UNIT\s*\(\s*\.MILLI\./i.test(text) ? 'mm' : /SI_UNIT\s*\([^)]*\.METRE\./i.test(text) ? 'm' : 'unknown';
  const productCount = [...text.matchAll(/\bPRODUCT\s*\(/gi)].length;
  return {
    name,
    geometry: { format: 'step', fileName, units, links: [{ id: 'cad-assembly', name: `${name} assembly`, massKg: null, centerOfMass: [0, 0, 0], inertia: [null, null, null], collision: 'derive-in-backend' }], joints: [], confirmed: false },
    physical: { totalMassKg: null, confirmed: false },
    assumptions: [`STEP geometry accepted (${productCount || 1} product record${productCount === 1 ? '' : 's'}). STEP does not reliably provide wiring or simulation-ready joints; confirm scale, materials, mass, inertia, collision meshes, and joint definitions.`]
  };
}

export function parseKicadNetlist(text, fileName = 'electronics.net') {
  const components = [];
  const connections = [];
  if (/<export\b|<components\b/i.test(text)) {
    for (const match of text.matchAll(/<comp\b([^>]*)>([\s\S]*?)<\/comp>/gi)) {
      const ref = attributes(match[1]).ref;
      const body = match[2];
      const value = body.match(/<value>\s*([^<]*)/i)?.[1]?.trim();
      const footprint = body.match(/<footprint>\s*([^<]*)/i)?.[1]?.trim();
      components.push({ id: slug(ref), name: value || ref, partNumber: value || '', reference: ref, footprint, kind: /bat|battery/i.test(value || ref) ? 'power-source' : /mcu|stm|esp|rasp|jetson|controller/i.test(value || '') ? 'controller' : 'module', pins: [] });
    }
    for (const net of text.matchAll(/<net\b([^>]*)>([\s\S]*?)<\/net>/gi)) {
      const netAttr = attributes(net[1]);
      const nodes = [...net[2].matchAll(/<node\b([^>]*)\/?\s*>/gi)].map((node) => attributes(node[1]));
      for (let index = 1; index < nodes.length; index += 1) connections.push({ id: slug(`${netAttr.name || netAttr.code}-${index}`), kind: /gnd/i.test(netAttr.name) ? 'ground' : /vcc|vbat|power|\+\d/i.test(netAttr.name) ? 'power' : 'signal', net: netAttr.name || String(netAttr.code), from: { component: slug(nodes[0].ref), pin: nodes[0].pin }, to: { component: slug(nodes[index].ref), pin: nodes[index].pin } });
    }
  } else {
    for (const match of text.matchAll(/\(comp\s+\(ref\s+"?([^\s")]+)"?\)[\s\S]*?\(value\s+"?([^\r\n")]+)"?\)/gi)) components.push({ id: slug(match[1]), name: match[2], reference: match[1], partNumber: match[2], kind: 'module', pins: [] });
  }
  return { components, connections, assumptions: [`KiCad netlist ${fileName} was imported. Add electrical ratings and pin capabilities from verified manufacturer data before readiness can pass.`] };
}

function splitTopLevel(source, delimiter = ',') {
  const parts = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === quote && source[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if ('[{('.includes(character)) depth += 1;
    if (']})'.includes(character)) depth -= 1;
    if (character === delimiter && depth === 0) { parts.push(current.trim()); current = ''; }
    else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function yamlPair(source) {
  let quote = null;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) { if (character === quote && source[index - 1] !== '\\') quote = null; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ('[{('.includes(character)) depth += 1;
    if (']})'.includes(character)) depth -= 1;
    if (character === ':' && depth === 0) return [source.slice(0, index).trim().replace(/^['"]|['"]$/g, ''), source.slice(index + 1).trim()];
  }
  return null;
}

function yamlComment(source) {
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) { if (character === quote && source[index - 1] !== '\\') quote = null; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === '#' && (index === 0 || /\s/.test(source[index - 1]))) return source.slice(0, index).trimEnd();
  }
  return source;
}

function parseYamlScalar(source) {
  const value = source.trim();
  if (!value || value === '~' || /^null$/i.test(value)) return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(value)) return Number(value);
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('[') && value.endsWith(']')) return splitTopLevel(value.slice(1, -1)).map(parseYamlScalar);
  if (value.startsWith('{') && value.endsWith('}')) {
    const result = {};
    for (const item of splitTopLevel(value.slice(1, -1))) {
      const pair = yamlPair(item);
      if (!pair) throw new Error(`Invalid inline YAML mapping item: ${item}`);
      result[pair[0]] = parseYamlScalar(pair[1]);
    }
    return result;
  }
  if (/^[&*!]|<<\s*:/.test(value)) throw new Error('YAML anchors, aliases, tags, and merge keys are not accepted in machine manifests.');
  return value;
}

export function parseYamlManifest(text) {
  if (/\t/.test(text)) throw new Error('YAML indentation must use spaces, not tabs.');
  const lines = text.split(/\r?\n/).map((raw, index) => {
    const content = yamlComment(raw).trim();
    return { line: index + 1, indent: raw.length - raw.trimStart().length, content };
  }).filter((line) => line.content && !/^---|\.\.\.$/.test(line.content));
  if (!lines.length) throw new Error('YAML manifest is empty.');
  const root = lines[0].content.startsWith('- ') ? [] : {};
  const stack = [{ indent: -1, value: root }];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    while (stack.length > 1 && stack.at(-1).indent >= line.indent) stack.pop();
    const parent = stack.at(-1).value;
    const next = lines[index + 1];
    const makeContainer = () => next && next.indent > line.indent && next.content.startsWith('- ') ? [] : {};
    if (line.content === '-' || line.content.startsWith('- ')) {
      if (!Array.isArray(parent)) throw new Error(`YAML line ${line.line} starts a sequence where a mapping was expected.`);
      const rest = line.content.slice(1).trim();
      if (!rest) {
        const child = makeContainer(); parent.push(child); stack.push({ indent: line.indent, value: child });
      } else {
        const pair = yamlPair(rest);
        if (pair) {
          const item = {};
          parent.push(item);
          if (!pair[0]) throw new Error(`YAML line ${line.line} has an empty key.`);
          if (pair[1]) item[pair[0]] = parseYamlScalar(pair[1]);
          else item[pair[0]] = makeContainer();
          stack.push({ indent: line.indent, value: item });
          if (!pair[1]) stack.push({ indent: line.indent + 1, value: item[pair[0]] });
        } else parent.push(parseYamlScalar(rest));
      }
      continue;
    }
    if (Array.isArray(parent)) throw new Error(`YAML line ${line.line} must start with '-' inside a sequence.`);
    const pair = yamlPair(line.content);
    if (!pair || !pair[0]) throw new Error(`YAML line ${line.line} is not a valid key/value mapping.`);
    if (pair[1]) parent[pair[0]] = parseYamlScalar(pair[1]);
    else { const child = makeContainer(); parent[pair[0]] = child; stack.push({ indent: line.indent, value: child }); }
  }
  if (!root || Array.isArray(root) || typeof root !== 'object') throw new Error('A machine YAML manifest must have a mapping at its root.');
  return normalizeMachineManifest(root);
}

export function parseGltf(input, fileName = 'preview.gltf') {
  let document;
  if (typeof input === 'string') document = JSON.parse(input);
  else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < 20) throw new Error('GLB file is too short.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error('GLB magic header is invalid.');
    if (view.getUint32(4, true) !== 2) throw new Error('Only glTF/GLB 2.0 is supported.');
    const jsonLength = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.byteLength) throw new Error('GLB JSON chunk is missing or corrupt.');
    document = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)).replace(/\0+$/g, '').trim());
  }
  if (!String(document.asset?.version || '').startsWith('2')) throw new Error('Only glTF 2.x assets are supported.');
  const nodes = document.nodes || [];
  const links = nodes.filter((node) => node.mesh != null).map((node, index) => ({ id: slug(node.name, `mesh-node-${index + 1}`), name: node.name || `Mesh node ${index + 1}`, massKg: null, centerOfMass: node.translation || [0, 0, 0], inertia: [null, null, null], collision: 'unspecified', meshIndex: node.mesh }));
  if (!links.length) links.push({ id: 'gltf-scene', name: fileName.replace(/\.[^.]+$/, ''), massKg: null, centerOfMass: [0, 0, 0], inertia: [null, null, null], collision: 'unspecified' });
  const joints = [];
  nodes.forEach((node, parentIndex) => (node.children || []).forEach((childIndex) => joints.push({ id: `node-${parentIndex}-to-${childIndex}`, name: `${node.name || `Node ${parentIndex}`} to ${nodes[childIndex]?.name || `Node ${childIndex}`}`, type: 'fixed', parent: slug(node.name, `mesh-node-${parentIndex + 1}`), child: slug(nodes[childIndex]?.name, `mesh-node-${childIndex + 1}`), axis: [0, 0, 0], inferredFromSceneGraph: true })));
  return {
    name: document.asset?.generator || fileName.replace(/\.[^.]+$/, ''),
    geometry: { format: fileName.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf', fileName, units: 'm', links, joints, preview: { sceneCount: (document.scenes || []).length, nodeCount: nodes.length, meshCount: (document.meshes || []).length, materialCount: (document.materials || []).length, animationCount: (document.animations || []).length }, coordinateFrame: 'glTF right-handed Y-up', confirmed: false },
    physical: { totalMassKg: null, confirmed: false },
    assumptions: ['glTF/GLB was accepted as a browser preview asset. It does not provide authoritative mass, inertia, collision geometry, wiring, or controller behaviour.']
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateZipEntry(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error(`ZIP compression method ${method} is not supported.`);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress deflated ZIP entries. Upload the extracted package contents instead.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseZipArchive(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = Math.max(0, bytes.byteLength - 65_557); index <= bytes.byteLength - 22; index += 1) if (view.getUint32(index, true) === 0x06054b50) eocd = index;
  if (eocd < 0) throw new Error('ZIP end-of-directory record was not found.');
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count > 100) throw new Error('ZIP package exceeds the 100-entry safety limit.');
  const entries = [];
  let totalSize = 0;
  let offset = directoryOffset;
  const decoder = new TextDecoder();
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP central directory is corrupt.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/');
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Unsafe ZIP entry path: ${name || '(empty)'}`);
    if (flags & 1) throw new Error(`Encrypted ZIP entry is not supported: ${name}`);
    totalSize += uncompressedSize;
    if (uncompressedSize > 15_000_000 || totalSize > 50_000_000) throw new Error('ZIP package exceeds the uncompressed-size safety limit.');
    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`ZIP local header is missing for ${name}.`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.byteLength) throw new Error(`ZIP entry data is truncated: ${name}`);
    const inflated = await inflateZipEntry(bytes.slice(dataOffset, dataOffset + compressedSize), method);
    if (inflated.byteLength !== uncompressedSize) throw new Error(`ZIP entry size does not match its directory record: ${name}`);
    if (crc32(inflated) !== expectedCrc) throw new Error(`ZIP entry failed CRC verification: ${name}`);
    entries.push({ name, bytes: inflated });
  }
  return entries;
}

async function contentFingerprint(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return `sha256-${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  let hash = 2166136261;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function mergeImported(base, imported, sourceFile) {
  const merged = normalizeMachineManifest(base);
  if (imported.schema === MANIFEST_SCHEMA || imported.version === 2) return normalizeMachineManifest({ ...imported, sourceFiles: [...merged.sourceFiles, ...(imported.sourceFiles || []), sourceFile] });
  if (imported.name && (!['gltf', 'glb'].includes(imported.geometry?.format) || merged.name === 'Untitled machine')) merged.name = imported.name;
  if (imported.family) merged.family = imported.family;
  if (imported.geometry) merged.geometry = { ...merged.geometry, ...imported.geometry };
  if (imported.physical) merged.physical = { ...merged.physical, ...imported.physical };
  if (imported.components?.length) merged.components = [...merged.components, ...imported.components.filter((item) => !merged.components.some((existing) => existing.id === item.id))];
  if (imported.connections?.length) merged.connections = [...merged.connections, ...imported.connections];
  merged.assumptions = [...merged.assumptions, ...(imported.assumptions || [])];
  merged.sourceFiles = [...merged.sourceFiles, sourceFile];
  merged.id = slug(merged.id || merged.name);
  return merged;
}

export async function importMachineFiles(files, startingManifest = createStarterManifest()) {
  let manifest = normalizeMachineManifest(startingManifest);
  const notices = [];
  const queue = [...files].map((file) => ({ file, depth: 0 }));
  while (queue.length) {
    const { file, depth } = queue.shift();
    const extension = file.name.split('.').pop().toLowerCase();
    if (file.size > 15_000_000) { notices.push({ severity: 'error', message: `${file.name} exceeds the 15 MB prototype import limit.` }); continue; }
    try {
      let cachedBuffer = null;
      const readBuffer = async () => cachedBuffer || (cachedBuffer = await file.arrayBuffer());
      const source = { name: file.name, size: file.size, type: file.type || extension, importedAt: new Date().toISOString(), hash: typeof file.arrayBuffer === 'function' ? await contentFingerprint(await readBuffer()) : null };
      if (extension === 'zip') {
        if (depth > 0) throw new Error('Nested ZIP packages are not accepted.');
        const entries = await parseZipArchive(await readBuffer());
        manifest.sourceFiles.push(source);
        const priority = (name) => /(?:^|\/)(?:machine|manifest|wiring|controller)(?:\.vidyut)?\.(?:json|ya?ml)$/i.test(name) ? 0 : 1;
        entries.sort((a, b) => priority(a.name) - priority(b.name));
        const virtualFiles = entries.map((entry) => ({
          file: {
            name: `${file.name}!/${entry.name}`,
            size: entry.bytes.byteLength,
            type: entry.name.split('.').pop().toLowerCase(),
            text: async () => new TextDecoder().decode(entry.bytes),
            arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength)
          },
          depth: depth + 1
        }));
        queue.unshift(...virtualFiles);
        notices.push({ severity: 'info', message: `${file.name} verified and expanded (${entries.length} file${entries.length === 1 ? '' : 's'}).` });
        continue;
      }
      const binary = extension === 'glb' ? await readBuffer() : null;
      const text = binary ? '' : await file.text();
      let imported;
      if (extension === 'json') imported = normalizeMachineManifest(JSON.parse(text));
      else if (extension === 'yaml' || extension === 'yml') imported = parseYamlManifest(text);
      else if (extension === 'urdf' || extension === 'xacro') imported = parseUrdf(text, file.name);
      else if (extension === 'sdf') imported = parseSdf(text, file.name);
      else if (extension === 'step' || extension === 'stp') imported = parseStep(text, file.name);
      else if (extension === 'gltf') imported = parseGltf(text, file.name);
      else if (extension === 'glb') imported = parseGltf(binary, file.name);
      else if (extension === 'net' || (extension === 'xml' && /<export\b|<components\b/i.test(text))) imported = parseKicadNetlist(text, file.name);
      else if (extension === 'xml' && /<robot\b/i.test(text)) imported = parseUrdf(text, file.name);
      else if (extension === 'xml' && /<sdf\b/i.test(text)) imported = parseSdf(text, file.name);
      else { notices.push({ severity: 'warning', message: `${file.name} was attached as reference material; no structured parser is available for .${extension}.` }); manifest.sourceFiles.push(source); continue; }
      manifest = mergeImported(manifest, imported, source);
      notices.push({ severity: 'info', message: `${file.name} imported as ${extension.toUpperCase()} source.` });
    } catch (error) {
      notices.push({ severity: 'error', message: `${file.name}: ${error.message}` });
    }
  }
  manifest.identity = { ...(manifest.identity || {}), sourceHashes: [...new Set((manifest.sourceFiles || []).map((source) => source.hash).filter(Boolean))] };
  return { manifest, notices, validation: validateMachineManifest(manifest) };
}

export function manifestFingerprint(manifest) {
  const input = JSON.stringify(normalizeMachineManifest(manifest));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
