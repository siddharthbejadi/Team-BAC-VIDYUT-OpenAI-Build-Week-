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
    sourceFiles: [],
    geometry: {
      format: overrides.geometry?.format || 'primitive',
      fileName: overrides.geometry?.fileName || null,
      units: overrides.geometry?.units || 'm',
      links: overrides.geometry?.links || [{ id: 'body', name: 'Main body', massKg: 1.2, centerOfMass: [0, 0, 0], inertia: [0.02, 0.02, 0.03], collision: 'box' }],
      joints: overrides.geometry?.joints || [],
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
      interfaces: Array.isArray(raw.interfaces) ? clone(raw.interfaces) : base.interfaces
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
  if (!(number(value.physical?.totalMassKg, 0) > 0)) issues.push(issue('blocker', 'MASS_REQUIRED', 'physical.totalMassKg', 'A positive total mass is required for execution.'));
  if (!value.physical?.confirmed) issues.push(issue('warning', 'PHYSICS_UNCONFIRMED', 'physical.confirmed', 'Mass, centre of mass, inertia, friction, or drag still require engineering confirmation.'));

  const components = new Map();
  for (const [index, component] of value.components.entries()) {
    const path = `components[${index}]`;
    if (!component.id) issues.push(issue('blocker', 'COMPONENT_ID_REQUIRED', `${path}.id`, 'Every component needs a stable ID.'));
    else if (components.has(component.id)) issues.push(issue('blocker', 'COMPONENT_ID_DUPLICATE', `${path}.id`, `Component ID ${component.id} is duplicated.`));
    else components.set(component.id, component);
    if (!component.name && !component.partNumber) issues.push(issue('warning', 'COMPONENT_NAME_MISSING', `${path}.name`, 'Add a component name or part number.'));
    if (component.confirmed === false) issues.push(issue('warning', 'COMPONENT_UNCONFIRMED', `${path}.confirmed`, `${component.name || component.id} was researched or inferred and still requires engineer confirmation against its source.`));
    if (component.kind === 'controller' && !(component.pins || []).length) issues.push(issue('warning', 'CONTROLLER_PINOUT_MISSING', `${path}.pins`, 'Controller pin definitions are missing; signal validation is limited.'));
  }
  if (value.components.length === 0) issues.push(issue('blocker', 'COMPONENTS_REQUIRED', 'components', 'Add the controller, power source, sensors, and actuators before testing.'));

  const drivenInputs = new Map();
  const poweredSinks = new Set();
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
    }
  }

  const demand = value.components.filter((component) => component.kind !== 'power-source').reduce((sum, component) => sum + Math.max(0, number(component.input?.currentA, 0)), 0);
  const capacity = value.components.filter((component) => component.kind === 'power-source').reduce((sum, component) => sum + Math.max(0, number(component.output?.maxCurrentA, 0)), 0);
  if (demand > 0 && capacity > 0 && demand > capacity) issues.push(issue('blocker', 'POWER_BUDGET_EXCEEDED', 'components', `Peak declared load is ${demand.toFixed(2)} A but source capacity is ${capacity.toFixed(2)} A.`));
  if (demand > 0 && capacity > 0 && demand > capacity * .8 && demand <= capacity) issues.push(issue('warning', 'POWER_MARGIN_LOW', 'components', `Peak load uses ${Math.round(demand / capacity * 100)}% of declared source capacity.`));

  for (const component of value.components) {
    if (component.kind !== 'power-source' && component.input && !poweredSinks.has(component.id)) issues.push(issue('blocker', 'COMPONENT_UNPOWERED', `components.${component.id}`, `${component.name || component.id} declares a power input but has no power connection.`));
  }
  const addresses = new Map();
  for (const component of value.components.filter((item) => item.bus === 'i2c' && item.address)) {
    const key = String(component.address).toLowerCase();
    if (addresses.has(key)) issues.push(issue('blocker', 'I2C_ADDRESS_CONFLICT', `components.${component.id}.address`, `${component.id} and ${addresses.get(key)} share I2C address ${component.address}.`));
    else addresses.set(key, component.id);
  }
  if (!value.interfaces.length) issues.push(issue('warning', 'CONTROLLER_INTERFACE_MISSING', 'interfaces', 'No SIL/HIL controller interface is configured.'));

  const blockers = issues.filter((item) => item.severity === 'blocker');
  const warnings = issues.filter((item) => item.severity === 'warning');
  return {
    valid: blockers.length === 0,
    ready: blockers.length === 0,
    issues,
    summary: { blockers: blockers.length, warnings: warnings.length, checks: 11, components: value.components.length, connections: value.connections.length, powerDemandA: Number(demand.toFixed(3)), powerCapacityA: Number(capacity.toFixed(3)) }
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
    const collision = /<mesh\b/i.test(body) ? 'mesh' : /<cylinder\b/i.test(body) ? 'cylinder' : /<sphere\b/i.test(body) ? 'sphere' : /<box\b/i.test(body) ? 'box' : 'unspecified';
    links.push({ id: slug(attr.name, `link-${links.length + 1}`), name: attr.name || `Link ${links.length + 1}`, massKg: number(mass), centerOfMass: xyz(origin), inertia: [number(inertia.ixx), number(inertia.iyy), number(inertia.izz)], collision });
  }
  const joints = [];
  for (const match of text.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi)) {
    const attr = attributes(match[1]);
    const body = match[2];
    const parent = attributes(body.match(/<parent\b([^>]*)\/?\s*>/i)?.[1]).link;
    const child = attributes(body.match(/<child\b([^>]*)\/?\s*>/i)?.[1]).link;
    const limit = attributes(body.match(/<limit\b([^>]*)\/?\s*>/i)?.[1]);
    joints.push({ id: slug(attr.name, `joint-${joints.length + 1}`), name: attr.name, type: attr.type || 'fixed', parent, child, lower: number(limit.lower), upper: number(limit.upper), effort: number(limit.effort), velocity: number(limit.velocity) });
  }
  const masses = links.map((link) => link.massKg).filter(Number.isFinite);
  return { name: robot, geometry: { format: 'urdf', fileName, units: 'm', links, joints, confirmed: false }, physical: { totalMassKg: masses.length === links.length ? masses.reduce((sum, mass) => sum + mass, 0) : null, confirmed: false }, assumptions: ['URDF geometry, collisions, joints, and inertial fields were parsed; validate meshes, coordinate frames, and every inferred property.'] };
}

export function parseSdf(text, fileName = 'machine.sdf') {
  const model = attributes(text.match(/<model\b([^>]*)>/i)?.[1]).name || fileName.replace(/\.[^.]+$/, '');
  const links = [];
  for (const match of text.matchAll(/<link\b([^>]*)>([\s\S]*?)<\/link>/gi)) {
    const attr = attributes(match[1]);
    const body = match[2];
    const mass = body.match(/<mass>\s*([^<]+)\s*<\/mass>/i)?.[1];
    const pose = body.match(/<inertial[\s\S]*?<pose>\s*([^<]+)\s*<\/pose>/i)?.[1];
    links.push({ id: slug(attr.name, `link-${links.length + 1}`), name: attr.name, massKg: number(mass), centerOfMass: xyz(pose), inertia: [null, null, null], collision: /<mesh\b/i.test(body) ? 'mesh' : /<collision\b/i.test(body) ? 'primitive' : 'unspecified' });
  }
  const joints = [];
  for (const match of text.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi)) {
    const attr = attributes(match[1]);
    const body = match[2];
    joints.push({ id: slug(attr.name, `joint-${joints.length + 1}`), name: attr.name, type: attr.type || 'fixed', parent: body.match(/<parent>\s*([^<]+)/i)?.[1]?.trim(), child: body.match(/<child>\s*([^<]+)/i)?.[1]?.trim() });
  }
  const masses = links.map((link) => link.massKg).filter(Number.isFinite);
  return { name: model, geometry: { format: 'sdf', fileName, units: 'm', links, joints, confirmed: false }, physical: { totalMassKg: masses.length === links.length ? masses.reduce((sum, mass) => sum + mass, 0) : null, confirmed: false }, assumptions: ['SDF structure was parsed; referenced meshes, plugins, sensors, and physical coefficients must be confirmed in the execution backend.'] };
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

function mergeImported(base, imported, sourceFile) {
  const merged = normalizeMachineManifest(base);
  if (imported.schema === MANIFEST_SCHEMA || imported.version === 2) return normalizeMachineManifest({ ...imported, sourceFiles: [...(imported.sourceFiles || []), sourceFile] });
  if (imported.name) merged.name = imported.name;
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
  for (const file of [...files]) {
    const extension = file.name.split('.').pop().toLowerCase();
    const source = { name: file.name, size: file.size, type: file.type || extension, importedAt: new Date().toISOString() };
    if (file.size > 15_000_000) { notices.push({ severity: 'error', message: `${file.name} exceeds the 15 MB prototype import limit.` }); continue; }
    const text = await file.text();
    try {
      let imported;
      if (extension === 'json') imported = normalizeMachineManifest(JSON.parse(text));
      else if (extension === 'urdf') imported = parseUrdf(text, file.name);
      else if (extension === 'sdf') imported = parseSdf(text, file.name);
      else if (extension === 'step' || extension === 'stp') imported = parseStep(text, file.name);
      else if (extension === 'net' || (extension === 'xml' && /<export\b|<components\b/i.test(text))) imported = parseKicadNetlist(text, file.name);
      else if (extension === 'xml' && /<robot\b/i.test(text)) imported = parseUrdf(text, file.name);
      else if (extension === 'xml' && /<sdf\b/i.test(text)) imported = parseSdf(text, file.name);
      else if (extension === 'zip') { notices.push({ severity: 'warning', message: `${file.name} was recorded, but browser ZIP extraction is not enabled. Upload the package contents together instead.` }); manifest.sourceFiles.push(source); continue; }
      else { notices.push({ severity: 'warning', message: `${file.name} was attached as reference material; no structured parser is available for .${extension}.` }); manifest.sourceFiles.push(source); continue; }
      manifest = mergeImported(manifest, imported, source);
      notices.push({ severity: 'info', message: `${file.name} imported as ${extension.toUpperCase()} source.` });
    } catch (error) {
      notices.push({ severity: 'error', message: `${file.name}: ${error.message}` });
    }
  }
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
