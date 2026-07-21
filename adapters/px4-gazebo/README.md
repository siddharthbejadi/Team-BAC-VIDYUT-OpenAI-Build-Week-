# PX4 / Gazebo adapter boundary

This directory contains the first bench-safe integration boundary for a real PX4 SITL/Gazebo runtime. It discovers a MAVLink heartbeat, records local-position, attitude, battery, and velocity telemetry, and exposes a deliberately small HTTP protocol to the VIDYUT server.

It does **not** arm a vehicle or forward actuator outputs. The health response keeps `vidyutExecutionReady` false until the adapter has been calibrated and the application-side streaming/evidence integration has been verified against a pinned PX4/Gazebo installation.

## Start after PX4 SITL is running

```powershell
python -m pip install pymavlink
python adapters/px4-gazebo/bridge.py --connection udp:127.0.0.1:14550
$env:PX4_BRIDGE_URL='http://127.0.0.1:8765'
node server.mjs
```

Check `http://127.0.0.1:8765/health`. The `ready` field becomes true after a PX4 heartbeat is received.

## Fault boundary

`POST /fault` currently maps GNSS wrong/off failures through `MAV_CMD_INJECT_FAILURE` when the installed PX4/MAVLink dialect supports it. Wind, terrain, collision, motor-force, and environment changes belong in a Gazebo world/system plugin and are explicitly returned as unsupported rather than being faked.

The next production step is to pin a PX4 release, Gazebo release, vehicle model, world, time step, and estimator configuration; then record repeatability and calibration evidence before changing `vidyutExecutionReady` to true.
