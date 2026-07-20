# Prototype testing guide

## Fastest judge path

1. Start the app and open the URL shown in the terminal.
2. Click **Judge demo**.
3. Watch GNSS drift separate the controller estimate from ground truth, link loss trigger autonomous hold, and wind disturb the machine.
4. Open **Evidence**. Confirm three individual test results, the deterministic seed, manifest fingerprint, event trace, and telemetry metrics.

## Full product path

1. On **Machine setup**, choose the drone reference machine or import `samples/custom-machine.json`.
2. Confirm the readiness panel has zero blockers. Upload `samples/invalid-voltage-machine.json` to see voltage and power checks block the workflow.
3. Upload `samples/demo-humanoid.urdf` to inspect parsed geometry/joints, or `samples/demo-kicad-netlist.xml` to inspect imported electronics/net connections.
4. On **Scenario builder**, select Himalayan range, lunar south pole, Mars, or a custom environment.
5. Select any compatible tests from the 25-test library. Tests can be combined in one plan.
6. Optionally enter a mission risk and generate a structured plan. With no API key, the UI labels the deterministic local planner honestly.
7. Continue to **Run & evidence**, choose SIL, and run the plan.
8. Export evidence JSON or telemetry CSV. Load a previous evidence JSON to restore its replay configuration.

## Component research

Enter `PCA9685`, `MPU6050`, `STM32F407`, `Raspberry Pi 5`, or `Jetson Orin Nano` in **Find verified fields**. These work from the offline starter catalog. With `OPENAI_API_KEY`, an unknown part uses GPT-5.6 plus web search to draft fields from current sources. Every draft remains unconfirmed until the engineer checks its linked source.

## HIL path

Use Chrome or Edge because Web Serial is required. Keep physical actuators disconnected.

1. Flash `samples/vidyut-controller-example.ino` to a compatible board with ArduinoJson 7 installed.
2. Open VIDYUT over `localhost` or HTTPS.
3. Select HIL and click **Connect**. Choose the board's serial port at the browser prompt.
4. Run the signal check, then the scenario. Sensor frames travel to the controller and normalized actuator commands return to the virtual machine.
5. Test Emergency stop and confirm injection pauses.

See `docs/HIL_PROTOCOL.md` for the message contract and safety limitations.

## Automated verification

```powershell
npm.cmd run check
npm.cmd test
```

The suite covers four machine families, all 25 tests, deterministic replay, individual evidence results, pre-run `NOT_RUN` behavior, electrical failures, readiness-valid reference machines, and URDF/STEP/KiCad parsing.
