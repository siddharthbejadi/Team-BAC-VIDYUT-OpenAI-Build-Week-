# Devpost submission draft — edit in your own voice before submitting

The organizers explicitly ask entrants not to paste an untouched AI-written description. Read this, correct anything that does not match your build, and add two or three sentences in your own voice about why you care about the problem.

## Project

**BAC VIDYUT**

**Tagline:** Test autonomous machines against virtual failures before risking hardware in the real world.

**Category:** Developer Tools

## Inspiration

Autonomous machines often meet their most expensive bugs during physical testing: a drone loses positioning near an inspection target, a rover loses vision on a slippery surface, or a humanoid actuator weakens mid-step. Large teams build specialized simulation and HIL infrastructure, but smaller teams still stitch together tools, scripts, logs, and reports. We wanted one test workflow that starts with the mission risk and ends with reproducible evidence.

## What it does

VIDYUT is a virtual proving ground for autonomous systems. An engineer selects or imports a machine profile, describes a mission risk, runs a sequence of virtual faults, watches ground truth diverge from what the controller believes, and exports the result as an evidence bundle.

The prototype includes four executable machine families—quadcopter, rover, humanoid, and CubeSat—plus a selectable library of 25 failure tests. It supports a fully virtual SIL controller and a bidirectional browser Web Serial HIL bridge: virtual sensors go to a real controller while normalized actuator commands return to the virtual machine and physical outputs stay disabled.

## How we built it

The application is a dependency-free Node.js and browser app. Its deterministic simulation core applies profile-specific motion, sensing, control-response, and safety rules. The same scenario schema drives every machine adapter, while each profile exposes only failures it can actually execute. Canvas renderers show ground truth, the controller estimate, path, faults, and safety telemetry. Every run has a seed and exports versioned JSON plus CSV.

The optional Failure Scenario Copilot calls GPT-5.6 through the Responses API. Structured Outputs constrain the model to the selected machine's allowed fault identifiers and exact executable schema. GPT-5.6 proposes the test; deterministic code runs and scores it. Without an API key, a clearly labelled local planner keeps the full judging path runnable.

## How we used Codex and GPT-5.6

Codex helped turn a broad cross-industry idea into a testable one-day scope, research official simulation interfaces, design the adapter and evidence contracts, build the application, add tests, diagnose behavior across three machine families, and prepare reproducible documentation. GPT-5.6 is also integrated in the product as the constrained mission-risk-to-scenario planner.

## Challenges

The hardest decision was refusing to fake universal physics. Supporting every drone, rover, and humanoid in one day would be dishonest. Instead, we made universality an interface contract: one scenario/evidence model, three genuine family implementations, an importable manifest, and clear next adapters for PX4/MAVLink and ROS 2/URDF.

## Accomplishments

- A complete machine-setup, scenario-builder, and evidence workflow.
- Multi-source machine import plus electrical readiness validation.
- One-click drone judge demo and four reference machine families.
- A 25-test library and seven configurable environments.
- Deterministic fault injection, recovery measurement, and evidence export.
- Strict separation between AI-generated test intent and deterministic verdicts.
- A real bidirectional browser-to-controller path using Web Serial.
- Automated tests for every reference machine and repeatable runs.

## What we learned

The moat is not another physics engine. The useful missing layer is test intent, adapters, reproducibility, comparison, and evidence across tools. Existing simulators become execution backends rather than products we need to replace.

## What's next

First, connect VIDYUT to PX4 SITL/HITL through MAVLink and validate GNSS degradation, link loss, and wind against one real flight controller. Next, add ROS 2 and URDF import for ground robots, sign evidence bundles, and compare firmware versions across identical seeds. Only then expand into higher-fidelity Isaac Sim/Gazebo backends and customer HIL benches.

## Built with

Codex, GPT-5.6, OpenAI Responses API, Structured Outputs, Node.js, JavaScript, HTML Canvas, Web Serial

## Required form answers to prepare

- Submitter type: Individual / Team / Organization
- Country of residence
- Category: Developer Tools
- Public or judge-shared code repository URL
- Optional deployed demo URL and testing instructions
- `/feedback` Codex Session ID from the primary build task
- Public YouTube demo URL under 3 minutes
