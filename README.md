# BAC VIDYUT

**A virtual proving ground for autonomous machines.** BAC VIDYUT lets an engineer describe a mission risk, inject failures into a digital test, inspect the machine's response, and export deterministic evidence before a risky physical trial.

This Build Week prototype proves one focused idea: a shared validation workflow can sit above machine-specific simulators and controllers. It includes executable reference profiles for a quadcopter, ground rover, and humanoid—not a claim that every real machine is already plug-and-play.

## The 60-second judge path

1. Run `node server.mjs` and open <http://127.0.0.1:4173>.
2. Click **60-second judge demo** in the header.
3. Watch the same runtime execute profile-specific failures for a drone, rover, and humanoid.
4. Open **Evidence report** and download the deterministic JSON/CSV bundle.
5. Type a mission risk into **Failure Scenario Copilot** and generate another runnable test.

## What works

- Three machine families: aerial, ground, and legged.
- Profile-specific dynamics, safety policies, faults, controller state, and pass assertions.
- Sequential fault injection for GNSS drift, link loss, wind, actuator loss, camera occlusion, wheel slip, IMU bias, joint torque loss, and battery sag.
- Deterministic seed-based runs, live telemetry, truth-versus-estimate visualization, runtime explanations, and evidence export.
- A portable JSON machine manifest; import `samples/custom-machine.json` from the UI.
- SIL mode and a real Web Serial HIL bridge. The bridge accepts newline-delimited controller telemetry such as `{"heading":4.2,"battery":91,"stability":78}` at 115200 baud.
- Optional GPT-5.6 scenario generation with strict structured output. Without an API key, the UI clearly uses a deterministic local demo planner so judges can test the entire product.
- Zero production dependencies: Node serves a browser-native application.

## Run locally

Requirements: Node.js 20 or newer and a current desktop browser.

```bash
node server.mjs
```

Open <http://127.0.0.1:4173>. Chrome or Edge is required only for the optional Web Serial hardware bridge.

To enable live scenario planning:

```powershell
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_MODEL="gpt-5.6"
node server.mjs
```

The API key stays server-side. Do not place it in browser code or commit it.

## Verify

```bash
node --test
node --check server.mjs
node --check public/js/app.js
```

The automated suite checks all three machine families, deterministic replay, fault/recovery traces, scenario validation, and custom manifests.

## Architecture

```text
Mission risk ──> GPT-5.6 scenario planner ──> schema-valid fault sequence
                                                     │
Machine manifest ──> family adapter ──> deterministic runtime ──> evidence v1
                         │                   │                    ├─ JSON report
                         │                   │                    └─ telemetry CSV
                         │                   └─ SIL controller
                         └─ Web Serial HIL bridge ──> real controller telemetry
```

The prototype's in-browser dynamics are deliberately lightweight and inspectable. A production build should orchestrate established physics and controller stacks—PX4/Gazebo for drones and ROS 2/Isaac Sim or equivalent for robots—rather than recreate every physics engine.

## How GPT-5.6 is used

When `OPENAI_API_KEY` is available, `/api/ai/scenario` calls the OpenAI Responses API with model `gpt-5.6`. Structured Outputs constrain the result to the machine's permitted fault identifiers and the exact executable scenario schema. The deterministic runtime—not the language model—decides the test outcome. This separation makes generated scenarios flexible while keeping test evidence repeatable.

## How Codex was used

Codex was the active engineering collaborator for this project. It was used to:

- turn the product thesis into a one-day, judgeable scope;
- research the official Build Week rules and optimize for its four judging criteria;
- design the adapter/runtime/evidence architecture;
- implement the complete dependency-free prototype and automated tests;
- diagnose the simulation behavior across three machine families;
- produce the reproducible setup, research brief, submission draft, and demo script.

The primary build task should be supplied as the `/feedback` Codex Session ID in the Devpost form.

## Honest scope and next adapters

This is an engineering workflow prototype, not a certified physics model or safety authority. Its built-in profiles demonstrate the interaction contract. Production adapters would connect:

- PX4 SITL/HITL and MAVLink for flight controllers;
- ROS 2 topics/actions and URDF-based robot descriptions;
- Gazebo, Isaac Sim, MuJoCo, or customer-selected physics engines;
- CAN/Ethernet/serial HIL interfaces through an isolated bridge service;
- signed, versioned test assets and customer-specific pass criteria.

## Repository map

```text
assets/                   Devpost cover artwork
public/index.html          Product UI
public/styles.css         Visual system
public/js/app.js           Interaction, canvas renderer, HIL bridge, evidence UI
public/js/engine.js        Deterministic simulation and evidence engine
public/js/profiles.js      Machine adapters, faults, and scenarios
server.mjs                 Static server and optional GPT-5.6 endpoint
test/engine.test.mjs       Automated verification
samples/                   Importable machine manifest
docs/                      Research, demo, and submission material
```

## License

MIT. See `LICENSE`.
