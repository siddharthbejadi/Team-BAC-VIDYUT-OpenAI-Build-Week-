const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));

export function seededRandom(seed = 42) {
  let state = (Number(seed) || 42) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function validateScenario(scenario, profile) {
  const errors = [];
  if (!scenario || typeof scenario !== "object") return { valid: false, errors: ["Scenario must be an object."] };
  if (!scenario.name || typeof scenario.name !== "string") errors.push("Scenario name is required.");
  if (!Number.isFinite(scenario.duration) || scenario.duration < 5 || scenario.duration > 60) errors.push("Duration must be between 5 and 60 seconds.");
  if (!Array.isArray(scenario.events) || scenario.events.length === 0) errors.push("At least one fault event is required.");
  for (const [index, event] of (scenario.events || []).entries()) {
    if (!profile.faults.includes(event.fault)) errors.push(`Event ${index + 1}: ${event.fault} is not supported by ${profile.name}.`);
    if (!Number.isFinite(event.start) || event.start < 0) errors.push(`Event ${index + 1}: start must be zero or greater.`);
    if (!Number.isFinite(event.duration) || event.duration <= 0) errors.push(`Event ${index + 1}: duration must be positive.`);
    if (!Number.isFinite(event.severity) || event.severity < 0.1 || event.severity > 1) errors.push(`Event ${index + 1}: severity must be between 0.1 and 1.`);
    if ((event.start || 0) + (event.duration || 0) > (scenario.duration || 0) + 0.01) errors.push(`Event ${index + 1}: event exceeds scenario duration.`);
  }
  return { valid: errors.length === 0, errors };
}

export class VidyutEngine {
  constructor(profile, scenario, options = {}) {
    const result = validateScenario(scenario, profile);
    if (!result.valid) throw new Error(result.errors.join(" "));
    this.profile = JSON.parse(JSON.stringify(profile));
    this.scenario = JSON.parse(JSON.stringify(scenario));
    this.seed = Number(options.seed) || 42;
    this.rng = seededRandom(this.seed);
    this.mode = options.mode || "SIL";
    this.reset();
  }

  reset() {
    const initial = this.profile.initial;
    this.state = {
      t: 0,
      x: initial.x,
      y: initial.y,
      observedX: initial.x,
      observedY: initial.y,
      vx: 0,
      vy: 0,
      altitude: initial.altitude || 0,
      heading: initial.heading || 0,
      battery: initial.battery || 100,
      perception: 100,
      link: 100,
      attitude: 0,
      stability: 100,
      jointLoad: 22,
      controller: "NOMINAL",
      phase: "READY",
      completed: false,
      safeStop: false,
      collision: false
    };
    this.telemetry = [];
    this.logs = [{ t: 0, level: "info", text: `${this.mode} runtime initialised with seed ${this.seed}` }];
    this.startedEvents = new Set();
    this.endedEvents = new Set();
    this.maxError = 0;
    this.minSafety = 100;
    this.recoveryStarted = null;
    this.recoveryTime = null;
    this.result = null;
    return this.snapshot();
  }

  activeFaults() {
    return this.scenario.events.filter((event) => this.state.t >= event.start && this.state.t <= event.start + event.duration);
  }

  severity(fault) {
    return this.activeFaults().filter((event) => event.fault === fault).reduce((max, event) => Math.max(max, event.severity), 0);
  }

  log(level, text) {
    if (this.logs.slice(-12).some((entry) => entry.text === text && this.state.t - entry.t < 8)) return;
    this.logs.push({ t: round(this.state.t, 1), level, text });
    if (this.logs.length > 80) this.logs.shift();
  }

  updateEventLog() {
    this.scenario.events.forEach((event, index) => {
      const key = `${index}-${event.fault}`;
      if (this.state.t >= event.start && !this.startedEvents.has(key)) {
        this.startedEvents.add(key);
        this.log("fault", `${event.fault.replaceAll('_', ' ')} injected at ${Math.round(event.severity * 100)}% severity`);
      }
      if (this.state.t >= event.start + event.duration && !this.endedEvents.has(key)) {
        this.endedEvents.add(key);
        this.log("recovery", `${event.fault.replaceAll('_', ' ')} cleared; measuring recovery`);
        this.recoveryStarted = this.recoveryStarted ?? this.state.t;
      }
    });
  }

  step(dt = 0.05, hardwareSample = null) {
    if (this.state.completed) return this.snapshot();
    dt = clamp(Number(dt) || 0.05, 0.005, 0.25);
    this.state.t = round(this.state.t + dt, 4);
    this.state.phase = "RUNNING";
    this.updateEventLog();

    if (hardwareSample && this.mode === "HIL") this.applyHardwareSample(hardwareSample);
    const family = this.profile.family.toLowerCase();
    if (family === "aerial") this.stepAerial(dt);
    else if (family === "legged") this.stepLegged(dt);
    else this.stepGround(dt);

    this.updateCommon(dt);
    this.captureTelemetry();
    if (this.state.t >= this.scenario.duration) this.finish();
    return this.snapshot();
  }

  applyHardwareSample(sample) {
    if (Number.isFinite(sample.heading)) this.state.heading = sample.heading;
    if (Number.isFinite(sample.battery)) this.state.battery = clamp(sample.battery, 0, 100);
    if (Number.isFinite(sample.attitude)) this.state.attitude = Math.abs(sample.attitude);
    if (Number.isFinite(sample.stability)) this.state.stability = clamp(sample.stability, 0, 100);
  }

  vectorToTarget(useObserved = true) {
    const sx = useObserved ? this.state.observedX : this.state.x;
    const sy = useObserved ? this.state.observedY : this.state.y;
    const dx = this.profile.target.x - sx;
    const dy = this.profile.target.y - sy;
    const distance = Math.hypot(dx, dy) || 1;
    return { dx, dy, distance, nx: dx / distance, ny: dy / distance };
  }

  stepAerial(dt) {
    const gnss = this.severity("gnss_drift");
    const linkLoss = this.severity("link_loss");
    const wind = this.severity("wind_gust");
    const motor = this.severity("motor_loss");
    const power = this.severity("battery_sag");
    const bias = gnss * Math.min(16, Math.max(0, this.state.t - 2) * 1.4);
    this.state.observedX = this.state.x + bias;
    this.state.observedY = this.state.y - bias * 0.64;
    this.state.link = clamp(100 - linkLoss * 100, 0, 100);
    const nav = this.vectorToTarget(true);
    const authority = clamp(1 - motor * 0.66 - power * 0.22, 0.18, 1);
    let commandedSpeed = 5.4 * authority;
    if (linkLoss > 0.4) {
      commandedSpeed = 0.8;
      this.state.controller = "AUTONOMOUS HOLD";
      this.log("action", "Command link lost → autonomous hold engaged");
    } else if (gnss > 0.55) {
      commandedSpeed *= 0.62;
      this.state.controller = "DEGRADED NAV";
      this.log("action", "Navigation confidence low → speed envelope reduced");
    } else {
      this.state.controller = "TRACKING";
    }
    const gustX = wind * 3.2;
    const gustY = -wind * 5.8;
    const response = clamp(2.2 * authority, 0.4, 2.2);
    this.state.vx += ((nav.nx * commandedSpeed + gustX) - this.state.vx) * response * dt;
    this.state.vy += ((nav.ny * commandedSpeed + gustY) - this.state.vy) * response * dt;
    this.state.x += this.state.vx * dt;
    this.state.y += this.state.vy * dt;
    this.state.attitude = clamp(Math.abs(gustY) * 3.1 + motor * 31 + Math.abs(this.state.vy) * 0.9, 0, 55);
    this.state.altitude = clamp(32 - motor * 7 + Math.sin(this.state.t * 1.4) * wind * 2, 0, 50);
    this.state.stability = clamp(100 - this.state.attitude * 1.45 - gnss * 12, 0, 100);
  }

  stepGround(dt) {
    const vision = this.severity("camera_occlusion");
    const slip = this.severity("wheel_slip");
    const linkLoss = this.severity("link_loss");
    const power = this.severity("battery_sag");
    this.state.perception = clamp(100 - vision * 96, 0, 100);
    this.state.link = clamp(100 - linkLoss * 100, 0, 100);
    this.state.observedX = this.state.x + slip * 4.4;
    this.state.observedY = this.state.y - slip * 2.1;
    const nav = this.vectorToTarget(true);
    const safeStop = vision > 0.72 || linkLoss > 0.7;
    const speed = safeStop ? 0 : 4.5 * (1 - slip * 0.58) * (1 - power * 0.25);
    if (safeStop) {
      this.state.controller = "SAFE STOP";
      this.state.safeStop = true;
      this.log("action", `${vision > linkLoss ? 'Perception uncertain' : 'Command link lost'} → controlled stop`);
    } else if (slip > 0.3) {
      this.state.controller = "TRACTION CONTROL";
      this.log("action", "Wheel slip detected → torque limited");
    } else {
      this.state.controller = "PATH TRACKING";
    }
    const lateral = slip * Math.sin(this.state.t * 2.3) * 2.4;
    this.state.vx += (nav.nx * speed - this.state.vx) * 2.4 * dt;
    this.state.vy += (nav.ny * speed + lateral - this.state.vy) * 2.4 * dt;
    this.state.x += this.state.vx * dt;
    this.state.y += this.state.vy * dt;
    this.state.heading = Math.atan2(this.state.vy, this.state.vx) * 180 / Math.PI;
    this.state.attitude = slip * 8;
    this.state.stability = clamp(100 - slip * 36 - vision * 14, 0, 100);
  }

  stepLegged(dt) {
    const joint = this.severity("joint_torque_loss");
    const imu = this.severity("imu_bias");
    const vision = this.severity("camera_occlusion");
    const power = this.severity("battery_sag");
    this.state.perception = clamp(100 - vision * 92, 0, 100);
    const perturbation = joint * 46 + imu * 27 + Math.abs(Math.sin(this.state.t * 2.8)) * 5;
    this.state.stability = clamp(100 - perturbation - power * 12, 0, 100);
    this.state.jointLoad = clamp(28 + joint * 78 + power * 18, 0, 120);
    const safeStop = this.state.stability < 38 || this.state.jointLoad > 91 || vision > 0.82;
    const nav = this.vectorToTarget(false);
    const speed = safeStop ? 0 : 2.75 * (1 - power * 0.28) * (1 - joint * 0.48);
    if (safeStop) {
      this.state.controller = "BALANCE HOLD";
      this.state.safeStop = true;
      this.log("action", "Stability envelope crossed → balance hold engaged");
    } else if (joint > 0.25 || imu > 0.3) {
      this.state.controller = "COMPENSATING";
      this.log("action", "State mismatch detected → gait shortened");
    } else {
      this.state.controller = "GAIT TRACKING";
    }
    this.state.vx += (nav.nx * speed - this.state.vx) * 3 * dt;
    this.state.vy += (nav.ny * speed - this.state.vy) * 3 * dt;
    this.state.x += this.state.vx * dt;
    this.state.y += this.state.vy * dt;
    this.state.attitude = clamp((100 - this.state.stability) * 0.32, 0, 35);
    this.state.heading = Math.sin(this.state.t * 5) * (4 + joint * 9);
    this.state.observedX = this.state.x + imu * 2.5;
    this.state.observedY = this.state.y;
  }

  updateCommon(dt) {
    const power = this.severity("battery_sag");
    const drain = (0.18 + Math.hypot(this.state.vx, this.state.vy) * 0.025 + power * 1.25) * dt;
    this.state.battery = clamp(this.state.battery - drain, 0, 100);
    const truth = this.vectorToTarget(false);
    const estimateError = Math.hypot(this.state.observedX - this.state.x, this.state.observedY - this.state.y);
    this.maxError = Math.max(this.maxError, estimateError, Math.max(0, truth.distance - 75) * 0.15);
    this.minSafety = Math.min(this.minSafety, this.state.stability, 100 - this.state.attitude * 1.8, this.state.perception);
    if (this.recoveryStarted && !this.recoveryTime && this.activeFaults().length === 0 && this.state.stability > 72) {
      this.recoveryTime = this.state.t - this.recoveryStarted;
      this.log("recovery", `Safety envelope recovered in ${this.recoveryTime.toFixed(1)} s`);
    }
    if (truth.distance < 3.5) {
      this.state.phase = "TARGET REACHED";
      this.log("success", "Mission waypoint reached inside the safety envelope");
    }
  }

  captureTelemetry() {
    if (this.telemetry.length && this.state.t - this.telemetry.at(-1).t < 0.12) return;
    const targetDistance = Math.hypot(this.profile.target.x - this.state.x, this.profile.target.y - this.state.y);
    this.telemetry.push({
      t: round(this.state.t, 2),
      x: round(this.state.x),
      y: round(this.state.y),
      targetDistance: round(targetDistance),
      stability: round(this.state.stability),
      battery: round(this.state.battery),
      perception: round(this.state.perception),
      link: round(this.state.link),
      attitude: round(this.state.attitude),
      jointLoad: round(this.state.jointLoad),
      controller: this.state.controller,
      faults: this.activeFaults().map((event) => event.fault)
    });
    if (this.telemetry.length > 600) this.telemetry.shift();
  }

  finish() {
    const distance = Math.hypot(this.profile.target.x - this.state.x, this.profile.target.y - this.state.y);
    const family = this.profile.family.toLowerCase();
    let passed;
    if (family === "aerial") passed = distance < 30 && this.state.attitude < 29 && this.state.battery > 20;
    else if (family === "legged") passed = this.minSafety > 16 && this.state.jointLoad < 112 && (distance < 45 || this.state.safeStop);
    else passed = this.minSafety > 14 && !this.state.collision && (distance < 35 || this.state.safeStop);
    this.state.completed = true;
    this.state.phase = passed ? "PASSED" : "REVIEW";
    this.result = this.buildReport(passed);
    this.log(passed ? "success" : "fault", passed ? "Test passed — evidence bundle sealed" : "Review required — safety assertion exceeded");
  }

  buildReport(passed = this.state.phase === "PASSED") {
    const distance = Math.hypot(this.profile.target.x - this.state.x, this.profile.target.y - this.state.y);
    const findings = [];
    if (this.maxError > 8) findings.push({ severity: "high", title: "Navigation estimate diverged", evidence: `Peak truth-to-estimate error ${this.maxError.toFixed(1)} m` });
    if (this.minSafety < 45) findings.push({ severity: this.minSafety < 20 ? "critical" : "medium", title: "Safety margin compressed", evidence: `Minimum calculated margin ${Math.max(0, this.minSafety).toFixed(0)}%` });
    if (this.state.safeStop) findings.push({ severity: "info", title: "Autonomous fallback verified", evidence: `Controller entered ${this.state.controller}` });
    if (findings.length === 0) findings.push({ severity: "info", title: "No safety assertion exceeded", evidence: "All monitored signals remained inside configured limits" });
    return {
      schema: "vidyut.evidence.v1",
      generatedAt: new Date().toISOString(),
      runId: `VYT-${this.profile.id.toUpperCase()}-${this.seed}-${String(Date.now()).slice(-5)}`,
      machine: { id: this.profile.id, name: this.profile.name, family: this.profile.family, adapter: this.profile.format },
      scenario: this.scenario,
      mode: this.mode,
      deterministicSeed: this.seed,
      verdict: passed ? "PASS" : "REVIEW",
      metrics: {
        finalDistance: round(distance, 1),
        peakEstimateError: round(this.maxError, 1),
        minimumSafetyMargin: round(Math.max(0, this.minSafety), 1),
        recoveryTime: this.recoveryTime ? round(this.recoveryTime, 1) : null,
        finalBattery: round(this.state.battery, 1)
      },
      assertions: this.profile.passRules,
      findings,
      eventLog: this.logs,
      telemetry: this.telemetry
    };
  }

  snapshot() {
    return {
      ...JSON.parse(JSON.stringify(this.state)),
      activeFaults: this.activeFaults().map((event) => ({ ...event })),
      telemetry: this.telemetry,
      logs: this.logs,
      result: this.result,
      maxError: this.maxError,
      minSafety: this.minSafety
    };
  }
}
