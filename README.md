# BAC VIDYUT

## One-hour live gripper proof

Flash `samples/vidyut-gripper-g474re.cpp` to the NUCLEO-G474RE, connect the PCA9685 gripper servo on channel 0, then open VIDYUT in desktop Chrome or Edge. In **Machine setup**, select the **Humanoid working adapter** to reveal its embedded live hardware controls, confirm the safety checklist, and connect at 115200 baud. Valid ±8° commands move the servo and update the virtual gripper only after an acknowledgement; the +30° safety command is rejected without motion.

VIDYUT is a test workflow for autonomous machines. An engineering team imports a mechanical model, declares electronics and controller interfaces, passes pre-run readiness checks, configures environments and failures, then runs repeatable software-in-the-loop (SIL) or bench-safe hardware-in-the-loop (HIL) tests before physical trials.

The hackathon demonstration focuses on a drone. Working reference profiles also show the same workflow for a rover, humanoid, and CubeSat.

## What is implemented

- A three-stage workflow: **Machine setup -> Scenario builder -> Run & evidence**.
- A versioned `vidyut.machine.v2` manifest combining geometry, physical properties, components, connections, interfaces, assumptions, and confirmations.
- Multi-file import for VIDYUT JSON/YAML, URDF/Xacro, SDF, STEP/STP metadata, glTF/GLB previews, KiCad XML netlists, reference attachments, and CRC-verified `.vidyut.zip` packages.
- URDF/SDF link, joint, inertial, limit, and collision extraction; STEP units/product extraction with explicit confirmation requirements.
- A component editor and wiring editor.
- Pre-run checks for geometry, mass/inertia/centre-of-mass consistency, link and joint topology, required and duplicate parts, voltage range, polarity patterns, regulators, duplicate drivers, component/pin references, PWM frequency, SPI chip-select reuse, UART direction/rate, I2C address conflicts by bus, CAN IDs/termination, controller mappings, power budget, unpowered loads, and bench-safety declarations.
- An offline starter component catalog plus optional GPT-5.6 web research for unknown part numbers. AI-researched fields stay unconfirmed until an engineer checks the linked source.
- Seven versioned environment presets: Himalayan range, urban canyon, desert, Arctic, rainforest, lunar south pole, and Mars crater rim. Every numeric field can be customized; GPT-5.6 or the transparent fallback can propose bounded values that remain unconfirmed until an engineer approves them.
- Exactly 25 selectable test templates across navigation, sensing, environment, actuation, power, communication, compute, mission, and multi-fault categories.
- A deterministic, seed-based executor with aerial, ground, legged, and spacecraft behavior.
- Truth-versus-controller visualization, live telemetry, event traces, recovery measurement, and per-test PASS/FAIL/NOT_RUN results.
- Evidence schema `vidyut.evidence.v2`, JSON/CSV/self-contained HTML export, assertion thresholds and supporting intervals, manifest/scenario fingerprints, run-integrity status, controller I/O evidence, and replay configuration import.
- A bidirectional Web Serial HIL bridge: virtual sensor injection goes to the real controller and normalized actuator commands return to and influence the virtual machine.
- Mandatory protocol handshake, sequence/integrity counters, a 750 ms command watchdog, logical signal check, command clamps, and latched emergency stop. VIDYUT never enables physical outputs in this prototype.
- Project-specific tests built from validated deterministic fault hooks, with a user-defined measurable assertion preserved in the evidence.
- Optional GPT-5.6 structured scenario planning through the OpenAI Responses API, with a transparent deterministic fallback when no API key is configured.
- A responsive UI and one-click judge demo.

## How we used Codex and GPT-5.6

We used **GPT-5.6 through Codex as an engineering collaborator throughout the build**, rather than only using it to generate an initial prototype. Codex helped us:

- turn the original product discussion into an implementable architecture, versioned schemas, and a three-stage user workflow;
- research HIL and SIL architecture, autonomous-machine simulators, component data, FMI 3.0, and ASAM OpenSCENARIO concepts;
- implement and refine the machine import pipeline, electrical-readiness validator, deterministic executor, Three.js proving ground, Web Serial bridge, evidence exports, coverage runner, and automated tests;
- diagnose the physical controller setup involving the NUCLEO-G474RE, PCA9685, MG996R servos, I2C mappings, and separate logic and actuator power domains;
- inspect test failures, review engineering claims, and keep unavailable external backends visibly unavailable instead of replacing them with fake results; and
- prepare the runnable demo, documentation, deployment, and verification suite used for this submission.

GPT-5.6 also has a constrained role inside the product. Through the server-side OpenAI Responses API and Structured Outputs, it can translate engineering intent into a bounded scenario draft and research an unknown component from manufacturer information. AI-produced values retain their sources and remain unconfirmed until an engineer reviews them. If no API key is configured, VIDYUT uses a transparent deterministic fallback so judges can still run the complete demonstration.

The responsibility boundary is deliberate: **GPT-5.6 helps interpret, research, and structure engineering intent; deterministic code executes the scenario, calculates telemetry, evaluates thresholds, and produces the evidence.** The language model is not presented as the physics engine or as a safety authority.

## Important engineering boundary

This prototype is functional, but it is not a certified physics model or safety authority.

- CAD/STEP provides geometry; it does not reliably provide wiring, firmware, pin behavior, or simulation-ready joints.
- URDF/SDF physical fields are imported when present but still require validation against the real assembly.
- GPT-5.6 organizes scenario intent and researches component drafts. It does not calculate the authoritative physics or declare the machine safe.
- The built-in executor is deterministic and inspectable for the hackathon. Production fidelity should come from adapters to PX4/Gazebo, ROS 2, Isaac Sim, MuJoCo, or the customer's selected backend.
- The browser HIL path proves bidirectional controller integration while the machine is stationary. Production HIL still needs isolated electrical I/O, hard real-time synchronization, a physical emergency stop, and validation on the selected controller.

## Run locally

Requirements: Node.js 20 or newer and a current browser.

```powershell
npm.cmd start
```

Open <http://127.0.0.1:4173>. Chrome or Edge is required only for Web Serial HIL. The SIL workflow works in other current browsers.

To enable GPT-5.6 scenario planning and manufacturer-document component research:

```powershell
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_MODEL="gpt-5.6"
npm.cmd start
```

The API key stays server-side. Never put it in browser code or commit it. The `gpt-5.6` alias currently routes to GPT-5.6 Sol; the integration uses the Responses API, Structured Outputs, low reasoning effort, and the `web_search` tool for unknown components.

## Test the prototype

Fast path:

1. Click **Judge demo**.
2. Watch GNSS drift, command-link loss, and wind act on the drone.
3. Open **Evidence** and inspect the three individual test-case results.

Full path:

1. Use a reference machine or import [`samples/demo-machine.vidyut.zip`](samples/demo-machine.vidyut.zip), [`samples/demo-machine.yaml`](samples/demo-machine.yaml), or [`samples/custom-machine.json`](samples/custom-machine.json).
2. Confirm readiness has zero blockers. Import [`samples/invalid-voltage-machine.json`](samples/invalid-voltage-machine.json) to see a deliberately blocked package.
3. Choose an environment and any compatible tests from the 25-test library.
4. Run in SIL and export evidence JSON, telemetry CSV, and the self-contained HTML report.
5. Load the evidence JSON to restore its replay configuration.

Detailed paths are in [`docs/TESTING.md`](docs/TESTING.md). The machine schema is in [`docs/MACHINE_PACKAGE_SPEC.md`](docs/MACHINE_PACKAGE_SPEC.md). The HIL contract and firmware example are in [`docs/HIL_PROTOCOL.md`](docs/HIL_PROTOCOL.md) and [`samples/vidyut-controller-example.ino`](samples/vidyut-controller-example.ino).

## Automated verification

```powershell
npm.cmd run check
npm.cmd test
```

The suite verifies:

- all four reference families;
- every one of the 25 test templates;
- deterministic telemetry and per-test results;
- pre-run `NOT_RUN` evidence behavior;
- readiness-valid built-in machines;
- incompatible voltage, over-current, duplicate drivers, I2C/SPI/UART/CAN conflicts, and mechanical consistency;
- YAML, verified ZIP, glTF/GLB, URDF, STEP, and KiCad parsing;
- HIL handshake, clamps, emergency stop, watchdog invalidation, and controller evidence;
- custom executable test definitions.

## Architecture

```text
CAD / URDF / SDF ---------> geometry + physical properties ----+
KiCad / component data ---> electronics + pin mapping ---------+--> vidyut.machine.v2
Visual editor ------------> confirmations + corrections -------+          |
                                                                          v
Mission risk --> GPT-5.6 structured planner or local planner --> executable test plan
                                                                          |
                                    +----------------------+--------------+
                                    |                      |
                              deterministic SIL      bench-safe HIL
                                                        sensor frames -> controller
                                                        actuator commands <- controller
                                    |                      |
                                    +----------+-----------+
                                               v
                                     vidyut.evidence.v2
                                  per-test results + replay
```

The product's defensible role is the test-intent, adapter, readiness, reproducibility, and evidence layer. Established physics and controller ecosystems become execution backends rather than systems VIDYUT should pretend to replace.

## 3D proving ground, coverage, and backend rollout

The run page now uses a real WebGL 3D scene with lit terrain, shadows, articulated machine geometry, chase/orbit/side/top cameras, aerial altitude and vertical-speed instruments, and an explicit surface constraint for rovers and legged machines. Uploaded self-contained `.gltf` or `.glb` geometry can replace the reference machine mesh; STEP remains an engineering-data import until a production CAD tessellation service is connected.

**Coverage sweep** executes 24 deterministic combinations across wind, payload, initial battery, and fault timing. The JSON result uses `vidyut.coverage.v1` and retains seeds, fingerprints, metrics, and individual test results for every run.

**Export backend package** produces `vidyut.backend-package.v1`. It preserves the machine, environment, scenario, seed, evidence requirements, an FMI 3.0 co-simulation variable contract, and an ASAM OpenSCENARIO concept mapping. These mappings are adapter contracts rather than an FMU or conformance-certified `.osc` file.

The backend selector exposes the honest runtime boundary:

- **VIDYUT deterministic preview** is executable immediately.
- **PX4 SITL + Gazebo** is enabled only after a configured bridge reports a calibrated VIDYUT execution stream. See [`adapters/px4-gazebo/README.md`](adapters/px4-gazebo/README.md).
- **FMI 3.0** remains unavailable until an external FMI runner is configured through `FMI_BRIDGE_URL`.

On this development computer WSL 2 and the Docker CLI are present, but Gazebo is not installed, Docker Desktop is not running, and a verified Pixhawk was not identified. Those external dependencies therefore remain deliberately unavailable in the UI instead of falling back to a fake result.

### Fast test path

1. Run `npm install`, then `npm start`.
2. Open `http://127.0.0.1:4173/?demo=1` for the automatic drone/Himalayan judge path.
3. Switch the camera to **Side profile** to see altitude changes, then select the rover preset to verify **SURFACE ONLY** motion.
4. Import `samples/invalid-voltage-machine.json` and confirm readiness blocks execution.
5. Restore the drone preset, run the scenario, open **Evidence**, and export JSON/CSV/HTML.
6. Click **Run coverage sweep** to execute the 24-case matrix and export coverage JSON.
7. Click **Export backend package** to inspect the PX4/FMI/OpenSCENARIO integration contract.
8. Run `npm test`; the current suite contains 18 passing tests.

## API routes

| Route | Purpose |
|---|---|
| `GET /health` | Runtime and capability status |
| `GET /api/ai/status` | Whether GPT-5.6 is configured |
| `POST /api/ai/scenario` | Convert a mission risk into a strict executable scenario |
| `POST /api/ai/component` | Load a curated component or research an unknown part with GPT-5.6 web search |

## Repository map

```text
public/index.html              Three-stage application shell
public/styles.css             Responsive visual system
public/js/app.js              Workflow, editors, renderer, report UI
public/js/catalog.js          25 tests, faults, environments
public/js/manifest.js         Import, normalization, readiness checks
public/js/engine.js           Deterministic execution and evidence v2
public/js/hil.js              Bidirectional bench-safe Web Serial bridge
public/js/profiles.js         Four executable reference machines
server.mjs                    Static server and optional GPT-5.6 endpoints
test/engine.test.mjs          Automated requirement verification
samples/                      Ready, invalid, URDF, KiCad, and controller examples
docs/                         Testing, package, HIL, research, and submission material
```

The exact implementation status and remaining external dependencies are tracked in [`docs/IMPLEMENTATION_AUDIT.md`](docs/IMPLEMENTATION_AUDIT.md).

## License

MIT. See [`LICENSE`](LICENSE).

The Sites worker exposes the same constrained GPT routes. Add `OPENAI_API_KEY` as a secret Sites environment variable (and optionally `OPENAI_MODEL=gpt-5.6`) to enable them in the deployed app; without it, the browser uses the deterministic planner.
