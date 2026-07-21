import { ENVIRONMENTS, TEST_LIBRARY } from './catalog.js';
import { manifestFingerprint } from './manifest.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const fingerprint = (value) => {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

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
    this.environment = JSON.parse(JSON.stringify(options.environment || ENVIRONMENTS.find((item) => item.id === scenario.environmentId) || ENVIRONMENTS[0]));
    this.manifest = options.manifest || profile.manifest || null;
    this.readiness = options.readiness || null;
    this.variant = JSON.parse(JSON.stringify(options.variant || scenario.variant || {}));
    this.adapter = options.adapter || (this.mode === 'HIL' ? 'web-serial' : 'deterministic-sil');
    this.lastActuatorCommand = null;
    this.simulator = { id: 'vidyut-fast-demo', version: '0.3.0', timeStepPolicy: 'bounded-variable-dt', fidelity: 'prototype-deterministic' };
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
      battery: Number.isFinite(Number(this.variant.initialBatteryPercent)) ? clamp(Number(this.variant.initialBatteryPercent), 0, 100) : initial.battery || 100,
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
      ,latencyMs: 0
      ,computeLoad: 28
      ,packetDelivery: 100
    };
    this.telemetry = [];
    this.hardwareTelemetry = [];
    this.actuatorCommands = [];
    this.hilSession = null;
    this.hilControl = null;
    this.lastHardwareKey = null;
    this.lastActuatorKey = null;
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

  step(dt = 0.05, hardwareSample = null, actuatorCommand = null) {
    if (this.state.completed) return this.snapshot();
    dt = clamp(Number(dt) || 0.05, 0.005, 0.25);
    this.state.t = round(this.state.t + dt, 4);
    this.state.phase = "RUNNING";
    this.updateEventLog();

    if (hardwareSample && this.mode === "HIL") this.applyHardwareSample(hardwareSample);
    if (actuatorCommand && this.mode === 'HIL') this.applyActuatorCommand(actuatorCommand);
    const family = this.profile.family.toLowerCase();
    if (family === "aerial") this.stepAerial(dt);
    else if (family === 'spacecraft') this.stepSpacecraft(dt);
    else if (family === "legged") this.stepLegged(dt);
    else this.stepGround(dt);

    this.applyUniversalFaults(dt);
    if (this.mode === 'HIL' && this.hilControl?.controllerState) this.state.controller = this.hilControl.controllerState;
    if (this.mode === 'HIL' && this.hilSession?.emergencyStopped) {
      this.state.safeStop = true;
      this.state.controller = 'HIL EMERGENCY STOP';
      this.state.vx *= Math.max(0, 1 - dt * 8);
      this.state.vy *= Math.max(0, 1 - dt * 8);
    }
    this.updateCommon(dt);
    this.captureTelemetry();
    if (this.state.t >= this.scenario.duration) this.finish();
    return this.snapshot();
  }

  applyHardwareSample(sample) {
    const key = sample.sequence ?? sample.receivedAt ?? JSON.stringify(sample);
    if (key === this.lastHardwareKey) return;
    this.lastHardwareKey = key;
    this.hardwareTelemetry.push({ t: round(this.state.t, 3), sample: JSON.parse(JSON.stringify(sample)) });
    if (this.hardwareTelemetry.length > 600) this.hardwareTelemetry.shift();
    if (Number.isFinite(sample.heading)) this.state.heading = sample.heading;
    if (Number.isFinite(sample.battery)) this.state.battery = clamp(sample.battery, 0, 100);
    if (Number.isFinite(sample.attitude)) this.state.attitude = Math.abs(sample.attitude);
    if (Number.isFinite(sample.stability)) this.state.stability = clamp(sample.stability, 0, 100);
  }

  applyActuatorCommand(command) {
    const key = command.sequence ?? command.receivedAt ?? JSON.stringify(command);
    if (key === this.lastActuatorKey) return;
    this.lastActuatorKey = key;
    this.lastActuatorCommand = JSON.parse(JSON.stringify(command));
    const outputs = Array.isArray(command.outputs) ? command.outputs : [];
    if (outputs.length) {
      const mean = outputs.reduce((sum, value) => sum + Number(value || 0), 0) / outputs.length;
      const differential = outputs.length > 1 ? Number(outputs.at(-1) || 0) - Number(outputs[0] || 0) : 0;
      const spread = Math.max(...outputs) - Math.min(...outputs);
      this.hilControl = { mean, differential, spread, controllerState: command.controllerState || 'HIL COMMAND' };
      this.state.attitude = clamp(this.state.attitude + spread * 8, 0, 60);
      this.state.heading += differential * 2;
      this.state.controller = this.hilControl.controllerState;
    }
    this.actuatorCommands.push({ t: round(this.state.t, 3), command: this.lastActuatorCommand });
    if (this.actuatorCommands.length > 600) this.actuatorCommands.shift();
  }

  recordHilSession(session) {
    if (this.mode !== 'HIL' || !session) return;
    this.hilSession = JSON.parse(JSON.stringify(session));
  }

  controlAuthority() {
    if (this.mode !== 'HIL') return 1;
    if (!this.hilControl) return 0;
    return clamp(Math.abs(this.hilControl.mean) * 2, 0, 1.2);
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
    const gnss = Math.max(this.severity("gnss_drift"), this.severity('sensor_dropout') * .75, this.severity('emi') * .45);
    const linkLoss = Math.max(this.severity("link_loss"), this.severity('packet_loss') * .65, this.severity('emi') * .35);
    const wind = Math.max(this.severity("wind_gust"), this.severity('precipitation') * .35);
    const motor = Math.max(this.severity("motor_loss"), this.severity('actuator_stuck') * .72);
    const power = Math.max(this.severity("battery_sag"), this.severity('power_brownout') * .8, this.severity('temperature_extreme') * .35);
    const gravityRatio = clamp(Number(this.environment.gravity || 9.80665) / 9.80665, .08, 2.5);
    const densityRatio = clamp(Number(this.environment.airDensity ?? 1.225) / 1.225, 0, 1.6);
    const referenceMass = Number(this.profile.manifest?.physical?.totalMassKg || this.manifest?.physical?.totalMassKg || 1);
    const configuredMass = Number(this.manifest?.physical?.totalMassKg || referenceMass) + Math.max(0, Number(this.variant.payloadKg || 0));
    const massAuthority = clamp(referenceMass / Math.max(.01, configuredMass), .48, 1.18);
    const aerodynamicAuthority = clamp(densityRatio / gravityRatio * massAuthority, .04, 1.25);
    const ambientWind = clamp(Number(this.environment.wind || 0) / 35, 0, 1);
    const bias = gnss * Math.min(16, Math.max(0, this.state.t - 2) * 1.4);
    this.state.observedX = this.state.x + bias;
    this.state.observedY = this.state.y - bias * 0.64;
    this.state.link = clamp(100 - linkLoss * 100, 0, 100);
    const nav = this.vectorToTarget(true);
    const authority = clamp((1 - motor * 0.66 - power * 0.22) * aerodynamicAuthority * this.controlAuthority(), 0.02, 1.1);
    let commandedSpeed = 5.4 * authority;
    if (linkLoss > 0.4) {
      commandedSpeed = 0.8;
      this.state.controller = "AUTONOMOUS HOLD";
      this.state.safeStop = true;
      this.log("action", "Command link lost → autonomous hold engaged");
    } else if (gnss > 0.55) {
      commandedSpeed *= 0.62;
      this.state.controller = "DEGRADED NAV";
      this.log("action", "Navigation confidence low → speed envelope reduced");
    } else {
      this.state.controller = "TRACKING";
    }
    const gustX = (wind + ambientWind * .08) * 3.2;
    const gustY = -(wind + ambientWind * .08) * 5.8;
    const response = clamp(2.2 * authority, 0.4, 2.2);
    this.state.vx += ((nav.nx * commandedSpeed + gustX) - this.state.vx) * response * dt;
    this.state.vy += ((nav.ny * commandedSpeed + gustY) - this.state.vy) * response * dt;
    this.state.x += this.state.vx * dt;
    this.state.y += this.state.vy * dt;
    this.state.attitude = clamp(Math.abs(gustY) * 3.1 + motor * 31 + Math.abs(this.state.vy) * 0.9, 0, 55);
    this.state.altitude = clamp(32 - motor * 7 - Math.max(0, .35 - aerodynamicAuthority) * this.state.t * 1.8 + Math.sin(this.state.t * 1.4) * wind * 2, 0, 50);
    this.state.stability = clamp(100 - this.state.attitude * 1.45 - gnss * 12, 0, 100);
    if (aerodynamicAuthority < .18) {
      this.state.controller = 'INSUFFICIENT LIFT';
      this.log('fault', `Atmosphere/gravity combination provides only ${Math.round(aerodynamicAuthority * 100)}% aerodynamic authority`);
    }
  }

  stepGround(dt) {
    const vision = Math.max(this.severity("camera_occlusion"), this.severity('low_visibility'), this.severity('sensor_dropout') * .8, this.severity('precipitation') * .55);
    const slip = Math.max(this.severity("wheel_slip"), this.severity('precipitation') * .58, this.severity('actuator_stuck') * .45);
    const linkLoss = Math.max(this.severity("link_loss"), this.severity('packet_loss') * .7);
    const power = Math.max(this.severity("battery_sag"), this.severity('power_brownout') * .8, this.severity('temperature_extreme') * .35);
    this.state.perception = clamp(100 - vision * 96, 0, 100);
    this.state.link = clamp(100 - linkLoss * 100, 0, 100);
    this.state.observedX = this.state.x + slip * 4.4;
    this.state.observedY = this.state.y - slip * 2.1;
    const nav = this.vectorToTarget(true);
    const declaredFriction = Number(this.manifest?.physical?.frictionCoefficient ?? .65);
    const gravityRatio = clamp(Number(this.environment.gravity || 9.80665) / 9.80665, .08, 2.5);
    const tractionAuthority = clamp(declaredFriction / .65 * Math.sqrt(gravityRatio), .12, 1.25);
    const safeStop = vision > 0.72 || linkLoss > 0.7;
    const speed = safeStop ? 0 : 4.5 * tractionAuthority * (1 - slip * 0.58) * (1 - power * 0.25) * this.controlAuthority();
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
    const joint = Math.max(this.severity("joint_torque_loss"), this.severity('actuator_stuck') * .72);
    const imu = Math.max(this.severity("imu_bias"), this.severity('sensor_dropout') * .6, this.severity('emi') * .45);
    const vision = Math.max(this.severity("camera_occlusion"), this.severity('low_visibility'), this.severity('precipitation') * .45);
    const power = Math.max(this.severity("battery_sag"), this.severity('power_brownout') * .8, this.severity('temperature_extreme') * .35);
    this.state.perception = clamp(100 - vision * 92, 0, 100);
    const gravityRatio = clamp(Number(this.environment.gravity || 9.80665) / 9.80665, .08, 2.5);
    const perturbation = joint * 46 + imu * 27 + Math.abs(Math.sin(this.state.t * 2.8)) * 5 + Math.abs(gravityRatio - 1) * 9;
    this.state.stability = clamp(100 - perturbation - power * 12, 0, 100);
    this.state.jointLoad = clamp((28 + joint * 78 + power * 18) * gravityRatio, 0, 120);
    const safeStop = this.state.stability < 38 || this.state.jointLoad > 91 || vision > 0.82;
    const nav = this.vectorToTarget(false);
    const speed = safeStop ? 0 : 2.75 * clamp(1 / Math.sqrt(gravityRatio), .55, 1.4) * (1 - power * 0.28) * (1 - joint * 0.48) * this.controlAuthority();
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

  stepSpacecraft(dt) {
    const attitudeSensor = Math.max(this.severity('imu_bias'), this.severity('sensor_dropout') * .7, this.severity('emi') * .5);
    const linkLoss = Math.max(this.severity('link_loss'), this.severity('packet_loss') * .7);
    const wheelLoss = Math.max(this.severity('motor_loss'), this.severity('actuator_stuck') * .75);
    const power = Math.max(this.severity('battery_sag'), this.severity('power_brownout') * .8, this.severity('temperature_extreme') * .35);
    const pressure = this.severity('pressure_altitude');
    const radiationNoise = Math.max(this.severity('emi'), this.severity('sensor_dropout'));
    const nav = this.vectorToTarget(false);
    const authority = clamp((1 - wheelLoss * .72 - power * .24) * this.controlAuthority(), .02, 1);
    const speed = 2.4 * authority;
    this.state.vx += (nav.nx * speed - this.state.vx) * .8 * dt;
    this.state.vy += (nav.ny * speed - this.state.vy) * .8 * dt;
    this.state.x += this.state.vx * dt;
    this.state.y += this.state.vy * dt;
    const bias = attitudeSensor * Math.min(8, this.state.t * .45);
    this.state.observedX = this.state.x + bias;
    this.state.observedY = this.state.y - bias * .4;
    this.state.link = clamp(100 - linkLoss * 100, 0, 100);
    this.state.altitude = 120 + Math.sin(this.state.t * .35) * 3;
    this.state.heading += (wheelLoss * 3.5 + pressure * .5) * dt;
    this.state.attitude = clamp(wheelLoss * 24 + pressure * 9 + radiationNoise * 7 + Math.abs(Math.sin(this.state.t)) * 1.5, 0, 45);
    this.state.stability = clamp(100 - this.state.attitude * 1.7 - radiationNoise * 20, 0, 100);
    this.state.controller = attitudeSensor > .4 ? 'STAR TRACKER HOLD' : 'ATTITUDE TRACKING';
    if (linkLoss > .6 || this.severity('power_brownout') > .5) {
      this.state.controller = 'ORBITAL SAFE MODE';
      this.state.safeStop = true;
      this.log('action', 'Communications or power margin low -> orbital safe mode engaged');
    }
  }

  applyUniversalFaults(dt) {
    const lowVisibility = Math.max(this.severity('low_visibility'), this.severity('precipitation') * .55);
    const emi = this.severity('emi');
    const sensor = this.severity('sensor_dropout');
    const latency = this.severity('latency_jitter');
    const packets = this.severity('packet_loss');
    const cpu = this.severity('cpu_overload');
    const memory = this.severity('memory_pressure');
    const obstacle = this.severity('obstacle_injection');
    const stuck = this.severity('actuator_stuck');
    const brownout = this.severity('power_brownout');
    const geofence = this.severity('geofence_breach');
    const pressure = this.severity('pressure_altitude');
    this.state.perception = clamp(this.state.perception - lowVisibility * 42 - sensor * 24 - emi * 12, 0, 100);
    this.state.link = clamp(this.state.link - packets * 58 - emi * 22, 0, 100);
    this.state.latencyMs = round(8 + latency * 180 + cpu * 95 + memory * 45, 1);
    this.state.computeLoad = round(clamp(28 + cpu * 76 + memory * 52, 0, 100), 1);
    this.state.packetDelivery = round(clamp(100 - packets * 82 - emi * 18, 0, 100), 1);
    this.state.stability = clamp(this.state.stability - latency * 13 - cpu * 9 - stuck * 18 - brownout * 22, 0, 100);
    this.state.attitude = clamp(this.state.attitude + stuck * 9 + pressure * 5, 0, 60);
    if (emi > 0) {
      this.state.observedX += Math.sin(this.state.t * 8.3) * emi * 2.2;
      this.state.observedY += Math.cos(this.state.t * 7.1) * emi * 1.8;
    }
    if (obstacle > .45) {
      this.state.safeStop = true;
      this.state.controller = 'OBSTACLE HOLD';
      this.state.vx *= Math.max(0, 1 - dt * 5);
      this.state.vy *= Math.max(0, 1 - dt * 5);
      this.log('action', 'Unexpected obstacle detected -> collision-avoidance hold');
      if (this.state.stability < 18 && obstacle > .85) this.state.collision = true;
    }
    if (brownout > .55) {
      this.state.controller = 'BROWNOUT RECOVERY';
      this.log('action', 'Controller supply below margin -> reset-safe state requested');
    }
    if (geofence > .45) {
      this.state.controller = 'GEOFENCE HOLD';
      this.state.safeStop = true;
      this.log('action', 'Geofence boundary approached -> route held');
    }
    if (this.severity('waypoint_reroute') > .25) {
      this.state.controller = 'ROUTE REPLAN';
      this.state.observedY += Math.sin(this.state.t) * 1.2;
      this.log('action', 'Mission waypoint changed -> route replanned');
    }
  }

  updateCommon(dt) {
    const power = Math.max(this.severity("battery_sag"), this.severity('power_brownout'), this.severity('temperature_extreme') * .5);
    const environmentLoad = Math.abs(Number(this.environment.temperature) - 20) / 100 + Number(this.environment.wind || 0) / 250;
    const referenceMass = Number(this.profile.manifest?.physical?.totalMassKg || this.manifest?.physical?.totalMassKg || 1);
    const payloadLoad = Math.max(0, Number(this.variant.payloadKg || 0)) / Math.max(.1, referenceMass);
    const drain = (0.18 + Math.hypot(this.state.vx, this.state.vy) * 0.025 + power * 1.25 + environmentLoad + payloadLoad * .38) * dt;
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
      observedX: round(this.state.observedX),
      observedY: round(this.state.observedY),
      vx: round(this.state.vx),
      vy: round(this.state.vy),
      altitude: round(this.state.altitude),
      heading: round(this.state.heading),
      targetDistance: round(targetDistance),
      stability: round(this.state.stability),
      battery: round(this.state.battery),
      perception: round(this.state.perception),
      link: round(this.state.link),
      attitude: round(this.state.attitude),
      jointLoad: round(this.state.jointLoad),
      controller: this.state.controller,
      latencyMs: this.state.latencyMs,
      computeLoad: this.state.computeLoad,
      packetDelivery: this.state.packetDelivery,
      actuatorSequence: this.lastActuatorCommand?.sequence ?? null,
      actuatorOutputs: Array.isArray(this.lastActuatorCommand?.outputs) ? [...this.lastActuatorCommand.outputs] : [],
      faults: this.activeFaults().map((event) => event.fault)
    });
    if (this.telemetry.length > 600) this.telemetry.shift();
  }

  finish() {
    const distance = Math.hypot(this.profile.target.x - this.state.x, this.profile.target.y - this.state.y);
    this.state.completed = true;
    this.state.phase = "COMPLETE";
    const evaluated = this.evaluateTestCases();
    const failed = evaluated.filter((test) => test.status === 'FAIL').length;
    const integrity = this.runIntegrity();
    this.log(!integrity.valid || failed ? 'fault' : 'success', !integrity.valid ? `Run integrity invalid: ${integrity.reasons.join(' ')}` : failed ? `${failed} test case(s) need engineering review; evidence bundle sealed` : 'All executed test cases met their configured assertions; evidence bundle sealed');
    this.result = this.buildReport();
  }

  runIntegrity() {
    if (this.mode !== 'HIL') return { valid: true, mode: 'SIL', reasons: [], warnings: [] };
    const reasons = [];
    const warnings = [];
    if (!this.hilSession) reasons.push('No HIL session metadata was captured.');
    else {
      if (!this.hilSession.connected) reasons.push('The controller was disconnected before the run completed.');
      if (!this.hilSession.synthetic && !this.hilSession.handshake?.acknowledged) reasons.push('The controller handshake was not verified.');
      if ((this.hilSession.integrity?.watchdogTrips || 0) > 0) reasons.push('The controller watchdog tripped during execution.');
      if (this.hilSession.emergencyStopped && (this.hilSession.integrity?.watchdogTrips || 0) === 0) warnings.push('The operator emergency stop was latched.');
      for (const [field, label] of [['malformed', 'malformed frames'], ['rejected', 'rejected frames'], ['saturated', 'clamped output frames'], ['droppedSequences', 'dropped sequences'], ['outOfOrder', 'out-of-order sequences']]) {
        const count = this.hilSession.integrity?.[field] || 0;
        if (count) warnings.push(`${count} ${label}`);
      }
      if (this.hilSession.synthetic) warnings.push('Synthetic browser controller was used; no physical controller timing was validated.');
    }
    return { valid: reasons.length === 0, mode: this.hilSession?.synthetic ? 'SYNTHETIC_HIL' : 'HIL', reasons, warnings, session: this.hilSession };
  }

  evaluateTestCases() {
    const selected = this.scenario.selectedTestIds?.length ? this.scenario.selectedTestIds : [...new Set(this.scenario.events.map((event) => event.testId).filter(Boolean))];
    return selected.map((testId) => {
      const definition = TEST_LIBRARY.find((test) => test.id === testId) || (this.scenario.testDefinitions || []).find((test) => test.id === testId);
      if (!definition) return { id: testId, name: testId, status: 'NOT_EVALUATED', assertion: 'No test definition found', evidence: 'Scenario referenced an unknown test ID.' };
      const events = this.scenario.events.filter((event) => event.testId === testId || event.fault === definition.fault);
      if (!this.state.completed) return { id: testId, name: definition.name, category: definition.category, status: 'NOT_RUN', assertion: definition.assertion, evidence: 'The configured run has not completed.' };
      if (!events.length) return { id: testId, name: definition.name, status: 'NOT_RUN', assertion: definition.assertion, evidence: 'No executable event was scheduled for this machine family.' };
      const integrity = this.runIntegrity();
      if (!integrity.valid) return { id: testId, name: definition.name, category: definition.category, status: 'NOT_EVALUATED', assertion: definition.assertion, evidence: `Run integrity was invalid: ${integrity.reasons.join(' ')}`, eventCount: events.length };
      let passed = this.minSafety > 12 && !this.state.collision;
      let threshold = { metric: 'minimumSafetyMargin', operator: '>', value: 12, unit: '%' };
      let measured = { value: round(Math.max(0, this.minSafety), 1), unit: '%' };
      if (definition.fault === 'gnss_drift') { passed = this.maxError < 22; threshold = { metric: 'peakEstimateError', operator: '<', value: 22, unit: 'm' }; measured = { value: round(this.maxError, 1), unit: 'm' }; }
      if (definition.fault === 'wind_gust' || definition.fault === 'pressure_altitude') { passed = this.state.attitude < 38; threshold = { metric: 'finalAttitude', operator: '<', value: 38, unit: 'deg' }; measured = { value: round(this.state.attitude, 1), unit: 'deg' }; }
      if (definition.fault === 'camera_occlusion' || definition.fault === 'low_visibility') { passed = this.state.safeStop || this.state.perception > 18; threshold = { metric: 'perceptionOrSafeStop', operator: '>', value: 18, unit: '%' }; measured = { value: round(this.state.perception, 1), unit: '%', safeStop: this.state.safeStop }; }
      if (definition.fault === 'link_loss' || definition.fault === 'obstacle_injection' || definition.fault === 'geofence_breach') { passed = this.state.safeStop || this.logs.some((entry) => entry.level === 'action' && /hold|safe mode|controlled stop/i.test(entry.text)); threshold = { metric: 'safeFallbackObserved', operator: '==', value: true, unit: 'boolean' }; measured = { value: passed, unit: 'boolean' }; }
      if (definition.fault === 'battery_sag' || definition.fault === 'power_brownout' || definition.fault === 'temperature_extreme') { passed = this.state.battery > 12; threshold = { metric: 'finalBattery', operator: '>', value: 12, unit: '%' }; measured = { value: round(this.state.battery, 1), unit: '%' }; }
      if (definition.fault === 'latency_jitter') { passed = this.state.latencyMs < 190; threshold = { metric: 'finalLatency', operator: '<', value: 190, unit: 'ms' }; measured = { value: this.state.latencyMs, unit: 'ms' }; }
      if (definition.fault === 'packet_loss') { passed = this.state.packetDelivery > 12; threshold = { metric: 'packetDelivery', operator: '>', value: 12, unit: '%' }; measured = { value: this.state.packetDelivery, unit: '%' }; }
      if (definition.fault === 'cpu_overload' || definition.fault === 'memory_pressure') { passed = this.state.computeLoad < 99; threshold = { metric: 'computeLoad', operator: '<', value: 99, unit: '%' }; measured = { value: this.state.computeLoad, unit: '%' }; }
      const interval = { start: round(Math.min(...events.map((event) => event.start)), 2), end: round(Math.max(...events.map((event) => event.start + event.duration)), 2), unit: 's' };
      return { id: testId, name: definition.name, category: definition.category, status: passed ? 'PASS' : 'FAIL', assertion: definition.assertion, threshold, measured, thresholdSource: 'VIDYUT prototype default; engineer approval required', supportingInterval: interval, evidence: `${threshold.metric} measured ${measured.value} ${measured.unit}; prototype threshold ${threshold.operator} ${threshold.value} ${threshold.unit}.`, eventCount: events.length };
    });
  }

  buildReport() {
    const distance = Math.hypot(this.profile.target.x - this.state.x, this.profile.target.y - this.state.y);
    const findings = [];
    if (this.maxError > 8) findings.push({ severity: "high", title: "Navigation estimate diverged", evidence: `Peak truth-to-estimate error ${this.maxError.toFixed(1)} m` });
    if (this.minSafety < 45) findings.push({ severity: this.minSafety < 20 ? "critical" : "medium", title: "Safety margin compressed", evidence: `Minimum calculated margin ${Math.max(0, this.minSafety).toFixed(0)}%` });
    if (this.state.safeStop) findings.push({ severity: "info", title: "Autonomous fallback verified", evidence: `Controller entered ${this.state.controller}` });
    if (findings.length === 0) findings.push({ severity: "info", title: "No safety assertion exceeded", evidence: "All monitored signals remained inside configured limits" });
    const testCases = this.evaluateTestCases();
    const failedCount = testCases.filter((test) => test.status === 'FAIL').length;
    const unevaluatedCount = testCases.filter((test) => test.status === 'NOT_EVALUATED').length;
    const integrity = this.runIntegrity();
    if (integrity.warnings.length) findings.push({ severity: integrity.valid ? 'warning' : 'high', title: 'Execution integrity notes', evidence: integrity.warnings.join('; ') });
    return {
      schema: "vidyut.evidence.v2",
      generatedAt: new Date().toISOString(),
      runId: `VYT-${this.profile.id.toUpperCase()}-${this.seed}-${String(Date.now()).slice(-5)}`,
      machine: { id: this.profile.id, name: this.profile.name, family: this.profile.family, adapter: this.profile.format },
      scenario: this.scenario,
      mode: this.mode,
      adapter: this.adapter,
      simulator: this.simulator,
      environment: this.environment,
      coverageVariant: this.variant,
      scenarioFingerprint: fingerprint(this.scenario),
      machineManifestFingerprint: this.manifest ? manifestFingerprint(this.manifest) : null,
      readiness: this.readiness,
      deterministicSeed: this.seed,
      overallAssessment: !this.state.completed ? 'NOT_RUN' : !integrity.valid ? 'INVALID_RUN' : failedCount || unevaluatedCount ? 'COMPLETE_WITH_FINDINGS' : 'COMPLETE',
      note: 'VIDYUT reports each configured test case individually; this is not a certification or whole-machine safety verdict.',
      metrics: {
        finalDistance: round(distance, 1),
        peakEstimateError: round(this.maxError, 1),
        minimumSafetyMargin: round(Math.max(0, this.minSafety), 1),
        recoveryTime: this.recoveryTime ? round(this.recoveryTime, 1) : null,
        finalBattery: round(this.state.battery, 1)
      },
      assertions: this.profile.passRules,
      testCases,
      findings,
      integrity,
      controller: { protocol: this.manifest?.interfaces?.[0]?.protocol || null, transport: this.manifest?.interfaces?.[0]?.transport || null, handshake: this.hilSession?.handshake || null, physicalActuatorsDisabled: this.manifest?.safety?.physicalActuatorsDisabled !== false },
      controllerEvidence: { hardwareTelemetry: this.hardwareTelemetry, actuatorCommands: this.actuatorCommands },
      eventLog: this.logs,
      telemetry: this.telemetry,
      explanations: [],
      replay: { profileId: this.profile.id, manifest: this.manifest, scenario: this.scenario, environment: this.environment, seed: this.seed, mode: this.mode, simulator: this.simulator, variant: this.variant }
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
