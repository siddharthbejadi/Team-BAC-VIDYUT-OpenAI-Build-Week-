const clone = (value) => JSON.parse(JSON.stringify(value));

export const BACKENDS = {
  vidyut: { id: 'vidyut', name: 'VIDYUT deterministic preview', adapter: 'deterministic-sil', fidelity: 'prototype-deterministic' },
  'px4-gazebo': { id: 'px4-gazebo', name: 'PX4 SITL + Gazebo bridge', adapter: 'px4-mavlink-gazebo', fidelity: 'external-physics' },
  fmi: { id: 'fmi', name: 'FMI 3.0 co-simulation bridge', adapter: 'fmi-3-cosimulation', fidelity: 'external-model' }
};

export async function backendStatus() {
  try {
    const response = await fetch('/api/backends/status', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Backend status failed (${response.status})`);
    return await response.json();
  } catch (error) {
    return {
      vidyut: { available: true, detail: 'Browser deterministic preview ready.' },
      'px4-gazebo': { available: false, detail: 'PX4 bridge is not connected.' },
      fmi: { available: false, detail: 'FMI bridge is not connected.' },
      error: error.message
    };
  }
}

export function buildBackendPackage({ backendId, manifest, scenario, environment, seed }) {
  const backend = BACKENDS[backendId] || BACKENDS.vidyut;
  return {
    schema: 'vidyut.backend-package.v1',
    generatedAt: new Date().toISOString(),
    backend: clone(backend),
    reproducibility: { seed: Number(seed) || 42, fixedStepSeconds: .01, requestedRealTimeFactor: 1, coordinateFrame: 'ENU', unitSystem: 'SI' },
    machine: clone(manifest),
    environment: clone(environment),
    scenario: clone(scenario),
    fmi3Mapping: {
      status: 'adapter-contract',
      standard: 'FMI 3.0 Co-Simulation / Scheduled Execution',
      inputs: ['environment.wind_ned_mps[3]', 'environment.gravity_mps2', 'fault.id', 'fault.severity', 'fault.active'],
      outputs: ['truth.position_enu_m[3]', 'truth.velocity_enu_mps[3]', 'sensor.frame', 'controller.outputs', 'vehicle.health'],
      clock: { name: 'vidyut_step', intervalSeconds: .01 }
    },
    openScenarioMapping: {
      status: 'cross-domain-mapping-draft-not-conformance-certified',
      standardConcept: 'ASAM OpenSCENARIO DSL scenario intent and event/action mapping',
      entities: [{ name: manifest.id, type: manifest.family }],
      environment: environment.id,
      events: scenario.events.map((event) => ({ name: event.testId || event.fault, startSeconds: event.start, durationSeconds: event.duration, action: { type: 'vidyut_fault_injection', fault: event.fault, severity: event.severity } }))
    },
    evidenceContract: { schema: 'vidyut.evidence.v2', requireMachineFingerprint: true, requireScenarioFingerprint: true, requireTelemetry: true, requirePerCaseResults: true },
    limitations: ['The FMI mapping is an executable adapter contract, not an FMU.', 'The OpenSCENARIO mapping preserves concepts but is not certified ASAM DSL conformance.', 'External backend calibration and version pinning are required before engineering use.']
  };
}
