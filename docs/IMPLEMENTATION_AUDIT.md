# VIDYUT implementation audit

Last verified: 20 July 2026. This file is the operational source of truth for what the hackathon prototype actually does. It intentionally distinguishes implemented behavior from claims that require external software, credentials, calibration, or physical equipment.

## Verified in the repository

| Requirement | Current evidence |
|---|---|
| Three-page product flow | Machine setup, Scenario builder, and Run & evidence are implemented as guarded workflow stages. |
| Drone-first demonstration | The one-click demo runs a Himalayan drone plan. Rover, humanoid, and CubeSat reference profiles use the same executor and evidence contract. |
| Machine package ingestion | JSON, safe-subset YAML, URDF/Xacro, SDF, STEP metadata, glTF/GLB, KiCad XML, references, and verified ZIP expansion are implemented. |
| Import provenance | Imported sources retain filenames and SHA-256 hashes where Web Crypto is available. ZIP entries receive CRC-32 validation. |
| Geometry/physical extraction | URDF/SDF links, joints, topology, axes, limits, collisions, sensors, meshes, and inertia tensor fields are parsed when declared. STEP and glTF boundaries are stated explicitly. |
| Electronics manifest/editor | Components, pins, connections, power data, buses, controller interfaces, coordinate frames, safety declarations, and provenance are represented and editable. |
| Pre-run readiness | Mechanical, electrical, power, PWM, I2C, SPI, UART, CAN, interface, controller-mapping, and bench-safety rules block or warn before execution. |
| Component discovery | Five curated reference components work offline. An optional server-side GPT-5.6 Responses API path can research unknown parts with web search; all drafts require engineer confirmation. |
| Environment configuration | Seven versioned presets, manual numeric customization, and bounded GPT/fallback proposals are available. Proposed values stay unconfirmed. |
| Test library | Exactly 25 deterministic templates are visible. Compatible tests can be combined, and a project-specific test can reuse a validated fault hook with its own assertion. |
| SIL execution | A deterministic seed-based browser executor runs aerial, ground, legged, and spacecraft profiles and records truth-versus-estimate telemetry. |
| Browser HIL protocol | Web Serial sends virtual sensor frames and consumes controller actuator commands. Commands influence the virtual plant. A mandatory handshake, sequence checks, clamps, watchdog, safety checklist, and emergency stop are implemented. |
| Evidence | Evidence v2 records fingerprints, seed, simulator version, environment provenance, readiness, run integrity, controller I/O, assertion thresholds, supporting intervals, telemetry, events, and replay data. JSON, CSV, and HTML exports are implemented. |
| Invalid-run handling | HIL handshake/watchdog problems produce `INVALID_RUN`/not-evaluated evidence instead of a misleading overall pass/fail. |
| Automated verification | `npm.cmd run check`, `npm.cmd test`, and `npm.cmd run build` pass. The suite currently contains 15 passing tests. |

## Implemented but not yet validated on the user's physical system

| Area | What is missing for proof |
|---|---|
| Real controller HIL | The protocol is implemented and tested with a synthetic bridge, but must be tested with the exact controller/firmware selected by the user. |
| Electrical correctness of a real machine | The readiness engine checks declared values; it cannot prove an undeclared wire, damaged board, grounding problem, transient, EMI issue, or actual current waveform. |
| AI production path | The Node server and Sites worker both implement constrained GPT-5.6 Responses API routes. A server-side `OPENAI_API_KEY` is still needed for a live production trace; the deterministic browser planner remains available without it. |
| Imported engineering values | Parsed CAD/robot-description values still require confirmation against the actual assembly, coordinate conventions, materials, payload, and measured centre of mass. |

## Not implemented as engineering-grade production claims

| Requirement | Required next implementation |
|---|---|
| PX4/Gazebo physics backend | Install and integrate a supported PX4 SITL + Gazebo runtime, map VIDYUT scenarios to backend faults, ingest telemetry, pin image/version, and run deterministic replay tests. No working PX4/Gazebo runtime is currently available on this machine. |
| Production CAD conversion | Add a server-side CAD kernel/conversion service for STEP assembly traversal, tessellation, collision-mesh generation, materials, mass properties, and unit/frame validation. Browser metadata parsing is not a CAD kernel. |
| Engineering calibration | Calibrate at least five drone faults against measured or trusted reference data and define versioned, source-backed thresholds with error bounds. |
| Hard real-time HIL | Add isolated interfaces, deterministic time synchronization, real-time transport, hardware watchdogs, and a physical emergency stop. Browser Web Serial is a prototype transport. |
| Security and multi-tenancy | Add authentication, authorization, tenant isolation, encryption policy, audit logs, retention/deletion rules, signed evidence, and a threat model. |
| Certification/safety authority | Define the applicable standards and independent verification process. VIDYUT must not claim certification or that a machine is globally safe. |

## Decisions or inputs required from the user

1. Exact first HIL controller and firmware: for example Pixhawk/PX4, STM32 custom firmware, Jetson, or Raspberry Pi.
2. Whether the deployed hackathon site may be public or must remain owner-only.
3. Where the server-side OpenAI API key will be configured for production; never paste the key into chat or browser code.
4. Which real physical trial and acceptance thresholds the drone demo is intended to reduce first.
5. Whether PX4/Gazebo is the chosen production physics backend, or whether another established simulator is required.

## Definition of “fully functional” for the hackathon

The prototype is hackathon-functional when the private or public URL loads, the machine package passes readiness, a scenario and environment can be configured, SIL completes, evidence exports and replays, and one real selected controller completes the HIL handshake and influences the virtual vehicle without physical outputs. Engineering-grade validation additionally requires the production-backend, calibration, hardware, safety, and security work listed above.
