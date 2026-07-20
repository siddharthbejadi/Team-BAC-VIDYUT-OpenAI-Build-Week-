# Prototype testing guide

## Fastest judge path

1. Start the app and open the URL shown in the terminal.
2. Click **Judge demo**.
3. Watch GNSS drift separate the controller estimate from ground truth, link loss trigger autonomous hold, and wind disturb the machine.
4. Open **Evidence**. Confirm three individual test results, the deterministic seed, manifest fingerprint, event trace, and telemetry metrics.

## Full product path

1. On **Machine setup**, choose the drone reference machine or import `samples/demo-machine.vidyut.zip`, `samples/demo-machine.yaml`, or `samples/custom-machine.json`.
2. Confirm the readiness panel has zero blockers. Upload `samples/invalid-voltage-machine.json` to see voltage and power checks block the workflow.
3. Upload `samples/demo-humanoid.urdf` to inspect parsed geometry/joints, `samples/demo-kicad-netlist.xml` to inspect electronics/net connections, or `samples/demo-preview.gltf` to attach a scene preview.
4. On **Scenario builder**, select Himalayan range, lunar south pole, Mars, or a custom environment.
5. Select any compatible tests from the 25-test library. Tests can be combined in one plan. Use **Add custom test** to create a project-specific test from a validated execution hook and measurable assertion.
6. Optionally enter a mission risk and generate a structured plan plus bounded environment proposal. With no API key, the UI labels the deterministic local planner honestly. Confirm AI-proposed environment numbers before treating the run as engineering evidence.
7. Continue to **Run & evidence**, choose SIL, and run the plan.
8. Export evidence JSON, telemetry CSV, or the self-contained HTML report. Load a previous evidence JSON to restore its manifest, environment, custom tests, seed, and plan.

## Component research

Enter `PCA9685`, `MPU6050`, `STM32F407`, `Raspberry Pi 5`, or `Jetson Orin Nano` in **Find verified fields**. These work from the offline starter catalog. With `OPENAI_API_KEY`, an unknown part uses GPT-5.6 plus web search to draft fields from current sources. Every draft remains unconfirmed until the engineer checks its linked source.

## HIL path

Use Chrome or Edge because Web Serial is required. Keep physical actuators disconnected.

1. Flash `samples/vidyut-controller-example.ino` to a compatible board with ArduinoJson 7 installed.
2. Open VIDYUT over `localhost` or HTTPS.
3. Select HIL, confirm the stationary-bench checklist, and click **Connect**. Choose the board's serial port at the browser prompt.
4. Confirm the controller returns a compatible `hello_ack` with `benchSafe: true` and `physicalOutputsAllowed: false`.
5. Run the signal check, then the scenario. Sensor frames travel to the controller and normalized actuator commands return to and influence the virtual machine.
6. Test Emergency stop and confirm injection pauses. If actuator commands stop for 750 ms, confirm the watchdog invalidates the run rather than silently treating it as valid evidence.

See `docs/HIL_PROTOCOL.md` for the message contract and safety limitations.

## Automated verification

```powershell
npm.cmd run check
npm.cmd test
```

The suite covers four machine families, all 25 tests, custom tests, deterministic replay, individual evidence results, pre-run `NOT_RUN` behavior, electrical and mechanical failures, readiness-valid reference machines, YAML/ZIP/glTF/GLB/URDF/STEP/KiCad parsing, and HIL handshake/watchdog/evidence behavior.
