# Technical research and positioning

This brief separates the market vision from what the one-day prototype can honestly prove.

## What established tools already do

| Tool / ecosystem | What it is strong at | Why it does not make VIDYUT redundant | Product relationship |
|---|---|---|---|
| NVIDIA Isaac Sim | High-fidelity robot physics, RTX sensors, synthetic data, URDF/USD import, ROS 2, and SIL/HIL workflows. | It is a powerful simulation foundation, not the lightweight cross-simulator test intent, fault-sequence, controller-adapter, and evidence workflow VIDYUT is demonstrating. | Integrate as a production execution backend; do not try to replace it. |
| PX4 SITL/HITL | Runs real PX4 flight code against a simulated vehicle; external simulators exchange sensor and actuator data. | It is excellent and drone/flight-stack specific. VIDYUT's value would be reusable scenario authoring, assertions, comparison, evidence, and a consistent workflow across stacks. | First serious drone adapter. |
| ROS 2 + URDF | Middleware and a standard robot-description format for links, joints, geometry, collision, and physical properties. | These describe/connect a robot; they do not by themselves decide which failures to run, score the response, or package a validation case. | Import/adapter layer for robot structure and controller I/O. |
| Gazebo | General robot simulator with physics, sensors, worlds, and integrations. | It is an execution engine. VIDYUT should be an orchestration and evidence layer that can run against Gazebo. | Open-source simulation backend option. |
| dSPACE | Industrial, real-time automotive SIL/HIL, sensor injection, buses, and synchronized test benches. | Its strength proves the HIL category. VIDYUT's startup wedge is a lighter, machine-agnostic workflow for teams that cannot begin with a large enterprise test bench. | Competitor at the enterprise end; integration/benchmark reference. |
| Applied Intuition / Foretellix | Large-scale scenario and safety validation for automated vehicles, including long-tail coverage. | They validate the need but are primarily automotive/AV-centered. VIDYUT begins with smaller autonomous-machine teams and a cross-domain adapter contract. | Competitive reference for mature scenario coverage. |
| CAD tools such as AutoCAD | Geometry, drawings, assemblies, and design documentation. | Geometry alone does not execute controller firmware, inject sensor faults, close the control loop, or measure a safe response. A 3D scan captures shape, not mass, inertia, propulsion, sensor models, or controller interfaces. | CAD is one possible source of geometry, not the testing system. |

## Defensible product statement

**VIDYUT is the test-intent and evidence layer between an autonomous system and the simulator or hardware bench that executes it.** It converts mission risks into repeatable failure scenarios, routes them through machine-specific adapters, compares truth with controller behavior, and produces a versioned engineering record.

That statement is stronger than “one simulator for everything.” It makes the existing ecosystem an advantage: VIDYUT can orchestrate mature engines instead of rebuilding them.

## One-day proof versus production claim

| Demonstrated now | Production work still required |
|---|---|
| One shared runtime with aerial, ground, and legged profiles | Physics-grade backend adapters and validated machine models |
| Nine executable failure types | Calibrated sensor/actuator fault libraries per platform |
| Deterministic replay and JSON/CSV evidence | Signed evidence, traceability, requirements tools, organization access controls |
| Browser Web Serial HIL telemetry bridge | Electrical I/O, CAN/Ethernet, hard real-time synchronization and bench safety |
| JSON machine manifest | URDF/SDF/USD/CAD ingest, calibration, and interface-mapping tools |
| GPT-5.6 schema-valid scenario planning | Domain-reviewed prompt/eval suite and customer-approved scenario libraries |

## Why the AI belongs here

The AI does not invent physics or declare a system safe. It translates an engineer's mission description into a constrained first draft of faults, timing, severity, and intent. Structured output makes this draft machine-executable. A deterministic engine and explicit assertions produce the verdict. This is useful, inspectable, and safer than allowing a model to grade its own scenario.

## Primary sources

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI model catalog: https://developers.openai.com/api/docs/models
- PX4 simulation, including SITL/HITL and Simulator MAVLink: https://docs.px4.io/main/en/simulation/
- PX4 failsafe simulation: https://docs.px4.io/main/en/simulation/failsafes
- ROS 2 URDF documentation: https://docs.ros.org/en/rolling/Tutorials/Intermediate/URDF/URDF-Main.html
- NVIDIA Isaac Sim: https://developer.nvidia.com/isaac/sim
- dSPACE HIL for autonomous driving: https://www.dspace.com/en/inc/home/products/systems/ecutest/hil_for_autonomous_driving.cfm
- Applied Intuition production deployment guide: https://resource.applied.co/production-deployment-guide
