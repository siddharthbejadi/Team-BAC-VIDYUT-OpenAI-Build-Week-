# 2:40 demo script

## 0:00–0:18 — Problem

“A drone, rover, or humanoid should not discover its worst controller bug during a costly physical trial. BAC VIDYUT is a virtual proving ground that turns a mission risk into a repeatable failure test and an engineering evidence bundle.”

Show the three-step interface, then point to the four reference machine profiles and the 25-test library.

## 0:18–0:52 — Drone failure

Select the drone and run **GNSS drift + link loss**.

“This is not a video. The controller estimate separates from ground truth as GNSS degrades. VIDYUT then removes the command link, records the autonomous hold, measures recovery, and keeps every sample against a deterministic seed.”

Let the fault banner, estimate ghost, runtime trace, and chart become visible.

## 0:52–1:18 — One engine, different machines

Click the rover, humanoid, and CubeSat profiles briefly or use **Judge demo**.

“Universality is an adapter contract, not one fake physics model. The rover exposes vision and traction failures, the humanoid exposes IMU and joint-torque failures, and the CubeSat exposes orbital safe mode. Each produces the same evidence schema.”

## 1:18–1:46 — GPT-5.6

Enter: “Inspect a bridge in gusty weather, then lose GNSS near the final waypoint.” Click **Generate stress test**.

“GPT-5.6 converts mission language into a strict, machine-valid failure sequence through Structured Outputs. The model proposes the test; deterministic software executes and scores it. That separation keeps the workflow flexible without asking AI to certify safety.”

If recording without an API key, say: “The live API is optional for judges; the transparent local planner keeps the demo fully runnable.” Do not imply the fallback is GPT-5.6.

## 1:46–2:10 — HIL bridge

Switch from SIL to HIL and show the controller connector.

“VIDYUT can also keep the physical machine stationary and ingest its real controller telemetry over the HIL bridge. This prototype uses browser Web Serial with newline JSON; production adapters target PX4/MAVLink, ROS 2, CAN, and customer benches.”

## 2:10–2:32 — Evidence

Open **Evidence** and download JSON.

“The output is not a screenshot or a single whole-machine verdict. It records each test case separately, plus the machine fingerprint, environment, scenario, seed, findings, event log, telemetry, and replay configuration.”

## 2:32–2:40 — Close

“BAC VIDYUT lets autonomous machines fail safely in a virtual world—before they fail expensively in the real one.”

## Recording checklist

- Public or unlisted YouTube URL that works in an incognito window.
- Under three minutes.
- Voiceover explicitly says what was built, how Codex was used, and how GPT-5.6 was used.
- Do not call the lightweight built-in dynamics “certification-grade.”
- Keep the browser at 100% zoom and record at 1920×1080 or 1440×900.
