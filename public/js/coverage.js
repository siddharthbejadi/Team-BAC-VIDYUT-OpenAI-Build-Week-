import { VidyutEngine } from './engine.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

export function runCoverageSweep({ profile, scenario, environment, manifest, readiness, baseSeed = 42 }) {
  const baseWind = Number(environment.wind || 0);
  const axes = {
    windMps: [...new Set([Math.max(0, baseWind - 6), baseWind, baseWind + 8].map((value) => round(value, 1)))],
    payloadKg: [0, .75],
    initialBatteryPercent: [100, 55],
    failureTimingOffsetSeconds: [-1, 1]
  };
  const runs = [];
  let runIndex = 0;
  for (const windMps of axes.windMps) for (const payloadKg of axes.payloadKg) for (const initialBatteryPercent of axes.initialBatteryPercent) for (const failureTimingOffsetSeconds of axes.failureTimingOffsetSeconds) {
    const runEnvironment = { ...clone(environment), wind: windMps, provenance: `${environment.provenance || 'VIDYUT environment'}; coverage wind=${windMps} m/s` };
    const runScenario = clone(scenario);
    runScenario.id = `${scenario.id || 'scenario'}-coverage-${runIndex + 1}`;
    runScenario.events = runScenario.events.map((event) => ({ ...event, start: Math.max(0, Math.min(runScenario.duration - event.duration, event.start + failureTimingOffsetSeconds)) }));
    runScenario.variant = { windMps, payloadKg, initialBatteryPercent, failureTimingOffsetSeconds };
    const seed = Number(baseSeed) + runIndex;
    const engine = new VidyutEngine(profile, runScenario, {
      seed,
      mode: 'SIL',
      environment: runEnvironment,
      manifest,
      readiness,
      adapter: 'coverage-deterministic-sil',
      variant: runScenario.variant
    });
    while (!engine.state.completed) engine.step(.05);
    const report = engine.result;
    const failedTests = report.testCases.filter((test) => test.status === 'FAIL').length;
    const unevaluatedTests = report.testCases.filter((test) => ['NOT_RUN', 'NOT_EVALUATED'].includes(test.status)).length;
    runs.push({
      index: runIndex + 1,
      seed,
      variant: clone(runScenario.variant),
      status: failedTests || unevaluatedTests ? 'FAIL' : 'PASS',
      failedTests,
      unevaluatedTests,
      metrics: report.metrics,
      testCases: report.testCases,
      fingerprints: { machine: report.machineManifestFingerprint, scenario: report.scenarioFingerprint }
    });
    runIndex += 1;
  }
  const passed = runs.filter((run) => run.status === 'PASS').length;
  const worstSafety = runs.reduce((worst, run) => Math.min(worst, run.metrics.minimumSafetyMargin), 100);
  const worstError = runs.reduce((worst, run) => Math.max(worst, run.metrics.peakEstimateError), 0);
  return {
    schema: 'vidyut.coverage.v1',
    generatedAt: new Date().toISOString(),
    machine: { id: profile.id, name: profile.name, family: profile.family },
    scenario: { id: scenario.id, name: scenario.name },
    axes,
    summary: { total: runs.length, passed, failed: runs.length - passed, passRatePercent: round(passed / runs.length * 100, 1), worstSafetyPercent: round(worstSafety, 1), worstEstimateErrorM: round(worstError, 1) },
    note: 'Coverage results are deterministic prototype evidence. Calibrate the selected production simulator before engineering sign-off.',
    runs
  };
}
