# BAC VIDYUT

VIDYUT is a test workflow for autonomous machines. An engineering team imports a mechanical model, declares electronics and controller interfaces, passes pre-run readiness checks, configures environments and failures, then runs repeatable software-in-the-loop (SIL) or bench-safe hardware-in-the-loop (HIL) tests before physical trials.

The hackathon demonstration focuses on a drone. Working reference profiles also show the same workflow for a rover, humanoid, and CubeSat.

## What is implemented

- A three-stage workflow: **Machine setup -> Scenario builder -> Run & evidence**.
- A versioned `vidyut.machine.v2` manifest combining geometry, physical properties, components, connections, interfaces, assumptions, and confirmations.
- Multi-file import for VIDYUT JSON, URDF, SDF, STEP/STP metadata, KiCad XML netlists, and reference attachments.
- URDF/SDF link, joint, inertial, limit, and collision extraction; STEP units/product extraction with explicit confirmation requirements.
- A component editor and wiring editor.
- Pre-run checks for mass/components, voltage range, polarity patterns, duplicate drivers, component/pin references, PWM frequency, UART direction, I2C address conflicts, power budget, and unpowered loads.
- An offline starter component catalog plus optional GPT-5.6 web research for unknown part numbers. AI-researched fields stay unconfirmed until an engineer checks the linked source.
- Seven environment presets: Himalayan range, urban canyon, desert, Arctic, rainforest, lunar south pole, and Mars crater rim; every numeric field can be customized.
- Exactly 25 selectable test templates across navigation, sensing, environment, actuation, power, communication, compute, mission, and multi-fault categories.
- A deterministic, seed-based executor with aerial, ground, legged, and spacecraft behavior.
- Truth-versus-controller visualization, live telemetry, event traces, recovery measurement, and per-test PASS/FAIL/NOT_RUN results.
- Evidence schema `vidyut.evidence.v2`, JSON/CSV export, manifest fingerprinting, and replay configuration import.
- A bidirectional Web Serial HIL bridge: virtual sensor injection goes to the real controller and normalized actuator commands return to the virtual machine.
- Bench-safe HIL invariants, logical signal check, clamps, and emergency stop. VIDYUT never enables physical outputs in this prototype.
- Optional GPT-5.6 structured scenario planning through the OpenAI Responses API, with a transparent deterministic fallback when no API key is configured.
- A responsive UI and one-click judge demo.

## Important engineering boundary

This prototype is functional, but it is not a certified physics model or safety authority.

- CAD/STEP provides geometry; it does not reliably provide wiring, firmware, pin behavior, or simulation-ready joints.
- URDF/SDF physical fields are imported when present but still require validation against the real assembly.
- GPT-5.6 organizes scenario intent and researches component drafts. It does not calculate the authoritative physics or declare the machine safe.
- The built-in executor is deterministic and inspectable for the hackathon. Production fidelity should come from adapters to PX4/Gazebo, ROS 2, Isaac Sim, MuJoCo, or the customer's selected backend.
- The browser HIL path proves bidirectional controller integration while the machine is stationary. Production HIL needs isolated electrical I/O, watchdogs, hard real-time synchronization, and a physical emergency stop.

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

1. Use a reference machine or import [`samples/custom-machine.json`](samples/custom-machine.json).
2. Confirm readiness has zero blockers. Import [`samples/invalid-voltage-machine.json`](samples/invalid-voltage-machine.json) to see a deliberately blocked package.
3. Choose an environment and any compatible tests from the 25-test library.
4. Run in SIL and export evidence JSON plus telemetry CSV.
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
- incompatible voltage, over-current, duplicate drivers, and I2C conflicts;
- URDF, STEP, and KiCad parsing.

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

## License

MIT. See [`LICENSE`](LICENSE).
