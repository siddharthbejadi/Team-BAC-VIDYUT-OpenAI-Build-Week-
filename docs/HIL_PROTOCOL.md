# VIDYUT bench-safe HIL protocol v1

The browser bridge uses newline-delimited JSON over Web Serial at 115200 baud. It is bidirectional: VIDYUT sends virtual sensor frames to the real controller, and the controller returns actuator commands and telemetry. The physical machine stays disarmed.

## Safety contract

- Every VIDYUT frame includes `benchSafe: true` and `physicalOutputsAllowed: false`.
- VIDYUT clamps returned actuator values to `[-1, 1]` and uses them only inside the virtual executor.
- The bridge overwrites a controller's returned `armed` value to `false` in its evidence record.
- Emergency stop pauses sensor injection and sends an `emergency_stop` message.
- The run cannot begin until a compatible `hello_ack` is received. A 750 ms command watchdog latches emergency stop if the active virtual plant stops receiving actuator commands.
- Malformed, rejected, saturated, dropped and out-of-order frames are counted in the evidence bundle.
- Do not connect motors, propellers, high-current drivers, or loaded servos during the prototype HIL demo.
- A production bench needs electrical isolation, a watchdog, hard real-time synchronization, and a hardware emergency stop. This browser bridge is not a certified safety device.

## Handshake

VIDYUT sends:

```json
{"type":"hello","protocol":"vidyut.hil.v1","benchSafe":true,"accepts":["sensor_frame","fault_state"],"produces":["actuator_command","telemetry"]}
```

The controller must reply before VIDYUT will inject sensor frames:

```json
{"type":"hello_ack","protocol":"vidyut.hil.v1","controller":"STM32-F407 bench controller","firmware":"0.3.0","benchSafe":true,"physicalOutputsAllowed":false}
```

## Sensor frame: VIDYUT to controller

Frames are rate-limited to 20 Hz.

```json
{
  "type": "sensor_frame",
  "protocol": "vidyut.hil.v1",
  "sequence": 101,
  "simulationTime": 5.05,
  "benchSafe": true,
  "physicalOutputsAllowed": false,
  "truth": { "position": [14.2, 61.9, 31.8], "velocity": [2.1, -1.4, 0], "heading": -18.2 },
  "sensors": { "position": [20.1, 58.2, 31.8], "batteryPercent": 89, "attitudeDeg": 8.4, "stabilityPercent": 77, "perceptionPercent": 100, "linkPercent": 100 },
  "environment": { "id": "himalayan", "gravity": 9.80665, "airDensity": 0.82, "temperature": -8, "wind": 12 },
  "faults": [{ "id": "gnss_drift", "severity": 0.72 }]
}
```

`truth` is retained by VIDYUT for comparison. A controller should make decisions from `sensors`, not `truth`.

## Actuator command: controller to VIDYUT

```json
{"type":"actuator_command","sequence":101,"armed":false,"outputs":[0.44,0.46,0.45,0.43],"controllerState":"DEGRADED_NAV"}
```

`outputs` can represent normalized motor, wheel, joint, or reaction-wheel commands. The selected machine adapter interprets them. No returned output is forwarded to physical actuators.

## Controller telemetry

```json
{"type":"telemetry","heading":-18.2,"battery":91,"attitude":8.4,"stability":77,"loopRateHz":200}
```

The current executor accepts `heading`, `battery`, `attitude`, and `stability` as controller-observed values in HIL mode.

## Signal check and emergency stop

VIDYUT can send:

```json
{"type":"signal_check","protocol":"vidyut.hil.v1","sequence":1,"benchSafe":true,"physicalOutputsAllowed":false,"pattern":"logical-only"}
```

or:

```json
{"type":"emergency_stop","protocol":"vidyut.hil.v1","physicalOutputsAllowed":false,"reason":"operator"}
```

After the operator has verified the bench, VIDYUT may send:

```json
{"type":"clear_emergency_stop","protocol":"vidyut.hil.v1","physicalOutputsAllowed":false}
```

The controller should acknowledge the signal check with telemetry and must immediately return zero/neutral simulated actuator commands after emergency stop. It must never interpret these normalized commands as permission to energize physical outputs.
