export const FAULT_LIBRARY = {
  gnss_drift: {
    label: "GNSS degradation",
    short: "GNSS",
    description: "Progressively biases the observed position without changing ground truth.",
    color: "#f7b955"
  },
  link_loss: {
    label: "Command-link loss",
    short: "LINK",
    description: "Drops operator commands and checks the configured autonomous fallback.",
    color: "#ff7a8a"
  },
  wind_gust: {
    label: "Cross-wind gust",
    short: "WIND",
    description: "Applies a lateral disturbance to the vehicle dynamics.",
    color: "#52d6c9"
  },
  motor_loss: {
    label: "Actuator degradation",
    short: "MOTOR",
    description: "Reduces available actuator authority and increases control error.",
    color: "#ff7a8a"
  },
  camera_occlusion: {
    label: "Camera occlusion",
    short: "VISION",
    description: "Reduces perception confidence and forces a safe-response decision.",
    color: "#a78bfa"
  },
  wheel_slip: {
    label: "Low-traction surface",
    short: "SLIP",
    description: "Reduces traction and introduces lateral drift.",
    color: "#f7b955"
  },
  imu_bias: {
    label: "IMU bias",
    short: "IMU",
    description: "Adds inertial-estimation bias and degrades balance confidence.",
    color: "#a78bfa"
  },
  joint_torque_loss: {
    label: "Joint torque loss",
    short: "JOINT",
    description: "Reduces one leg actuator's authority during locomotion.",
    color: "#ff7a8a"
  },
  battery_sag: {
    label: "Battery voltage sag",
    short: "POWER",
    description: "Reduces the energy and peak power available to the controller.",
    color: "#f7b955"
  }
};

export const MACHINE_PROFILES = {
  drone: {
    id: "drone",
    name: "VX-4 Quadcopter",
    family: "Aerial",
    format: "MAVLink / PX4 adapter",
    accent: "#5eead4",
    target: { x: 82, y: 24 },
    initial: { x: 12, y: 74, altitude: 32, heading: -20, battery: 100 },
    capabilities: ["position", "altitude", "attitude", "link", "battery"],
    faults: ["gnss_drift", "link_loss", "wind_gust", "motor_loss", "battery_sag"],
    objective: "Reach inspection waypoint and recover within the safety corridor.",
    passRules: ["Position error < 18 m", "Attitude < 28°", "Battery > 20%"]
  },
  rover: {
    id: "rover",
    name: "TR-7 Ground Rover",
    family: "Ground",
    format: "ROS 2 / JSON adapter",
    accent: "#60a5fa",
    target: { x: 84, y: 32 },
    initial: { x: 12, y: 72, altitude: 0, heading: -15, battery: 100 },
    capabilities: ["odometry", "vision", "steering", "link", "battery"],
    faults: ["camera_occlusion", "wheel_slip", "link_loss", "battery_sag"],
    objective: "Navigate to the delivery zone without entering the exclusion area.",
    passRules: ["Cross-track error < 14 m", "Perception > 25%", "No obstacle contact"]
  },
  humanoid: {
    id: "humanoid",
    name: "ATLAS-H Service Humanoid",
    family: "Legged",
    format: "URDF / ROS 2 adapter",
    accent: "#a78bfa",
    target: { x: 78, y: 54 },
    initial: { x: 18, y: 54, altitude: 0, heading: 0, battery: 100 },
    capabilities: ["joint state", "balance", "vision", "IMU", "battery"],
    faults: ["joint_torque_loss", "imu_bias", "camera_occlusion", "battery_sag"],
    objective: "Cross the workcell and stop safely if stability becomes uncertain.",
    passRules: ["Balance margin > 18%", "Joint load < 92%", "Controlled stop on fault"]
  }
};

export const PRESET_SCENARIOS = {
  drone: [
    {
      id: "drone-gnss-link",
      name: "GNSS drift + link loss",
      intent: "Validate autonomous recovery when navigation and operator link degrade in sequence.",
      duration: 18,
      events: [
        { fault: "gnss_drift", start: 3.2, duration: 6.8, severity: 0.72 },
        { fault: "link_loss", start: 8.1, duration: 4.2, severity: 1 },
        { fault: "wind_gust", start: 11.4, duration: 3.1, severity: 0.58 }
      ]
    },
    {
      id: "drone-actuator",
      name: "Actuator + power margin",
      intent: "Measure control authority during combined motor degradation and battery sag.",
      duration: 18,
      events: [
        { fault: "battery_sag", start: 2.5, duration: 12, severity: 0.55 },
        { fault: "motor_loss", start: 7, duration: 5.5, severity: 0.64 }
      ]
    }
  ],
  rover: [
    {
      id: "rover-vision-slip",
      name: "Occlusion + wheel slip",
      intent: "Check whether the rover slows safely when perception and traction degrade together.",
      duration: 18,
      events: [
        { fault: "camera_occlusion", start: 3.4, duration: 6.2, severity: 0.8 },
        { fault: "wheel_slip", start: 7.2, duration: 5.5, severity: 0.68 }
      ]
    },
    {
      id: "rover-link",
      name: "Remote link interruption",
      intent: "Verify autonomous safe-stop and controlled mission resumption.",
      duration: 16,
      events: [
        { fault: "link_loss", start: 4.2, duration: 5.4, severity: 1 },
        { fault: "battery_sag", start: 10, duration: 4, severity: 0.45 }
      ]
    }
  ],
  humanoid: [
    {
      id: "humanoid-joint-imu",
      name: "Joint loss + IMU bias",
      intent: "Test controlled stopping before a local actuator fault becomes a fall.",
      duration: 18,
      events: [
        { fault: "imu_bias", start: 3.5, duration: 7.5, severity: 0.52 },
        { fault: "joint_torque_loss", start: 7, duration: 5, severity: 0.76 }
      ]
    },
    {
      id: "humanoid-vision-power",
      name: "Vision + power degradation",
      intent: "Validate safe motion under partial perception and reduced peak power.",
      duration: 17,
      events: [
        { fault: "camera_occlusion", start: 3, duration: 6, severity: 0.7 },
        { fault: "battery_sag", start: 8, duration: 6, severity: 0.62 }
      ]
    }
  ]
};

export function cloneScenario(scenario) {
  return JSON.parse(JSON.stringify(scenario));
}

export function validateMachineManifest(value) {
  const errors = [];
  if (!value || typeof value !== "object") errors.push("Manifest must be a JSON object.");
  if (!value?.id || !/^[a-z0-9-]+$/i.test(value.id)) errors.push("id must contain only letters, numbers, or hyphens.");
  if (!value?.name || typeof value.name !== "string") errors.push("name is required.");
  if (!['aerial', 'ground', 'legged'].includes(String(value?.family || '').toLowerCase())) errors.push("family must be aerial, ground, or legged.");
  if (!Array.isArray(value?.faults) || value.faults.length === 0) errors.push("faults must be a non-empty array.");
  const unknown = (value?.faults || []).filter((fault) => !FAULT_LIBRARY[fault]);
  if (unknown.length) errors.push(`Unknown fault(s): ${unknown.join(', ')}`);
  return { valid: errors.length === 0, errors };
}

export function profileFromManifest(value) {
  const check = validateMachineManifest(value);
  if (!check.valid) throw new Error(check.errors.join(" "));
  const family = value.family.toLowerCase();
  const base = family === "aerial" ? MACHINE_PROFILES.drone : family === "legged" ? MACHINE_PROFILES.humanoid : MACHINE_PROFILES.rover;
  return {
    ...JSON.parse(JSON.stringify(base)),
    ...value,
    id: value.id,
    family: family[0].toUpperCase() + family.slice(1),
    format: value.format || "VIDYUT JSON adapter",
    target: value.target || base.target,
    initial: { ...base.initial, ...(value.initial || {}) },
    capabilities: value.capabilities || base.capabilities,
    passRules: value.passRules || base.passRules
  };
}
