#!/usr/bin/env python3
"""Bench-safe PX4/Gazebo discovery and telemetry bridge for VIDYUT.

This bridge never arms the vehicle or forwards actuator commands. It exposes
heartbeat and estimator telemetry and can request PX4's supported failure
injection command for explicitly mapped sensor failures.
"""

from __future__ import annotations

import argparse
import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from pymavlink import mavutil
except ImportError:  # Reported through /health instead of crashing.
    mavutil = None


class BridgeState:
    def __init__(self, connection: str):
        self.connection_string = connection
        self.lock = threading.Lock()
        self.link = None
        self.ready = False
        self.error = None
        self.heartbeat = None
        self.telemetry = {}
        self.session = None
        self.started_at = time.time()

    def snapshot(self):
        with self.lock:
            return {
                "protocol": "vidyut.px4.bridge.v1",
                "ready": self.ready,
                "vidyutExecutionReady": False,
                "benchSafe": True,
                "armedCommandsAllowed": False,
                "connection": self.connection_string,
                "heartbeat": self.heartbeat,
                "telemetry": dict(self.telemetry),
                "session": self.session,
                "error": self.error,
                "uptimeSeconds": round(time.time() - self.started_at, 1),
                "limitation": "Telemetry discovery is implemented. End-to-end VIDYUT streaming remains gated until calibrated against an installed PX4/Gazebo runtime."
            }

    def connect_loop(self):
        if mavutil is None:
            with self.lock:
                self.error = "pymavlink is not installed; run: python -m pip install pymavlink"
            return
        try:
            link = mavutil.mavlink_connection(self.connection_string, autoreconnect=True)
            heartbeat = link.wait_heartbeat(timeout=15)
            with self.lock:
                self.link = link
                self.ready = True
                self.heartbeat = {
                    "system": link.target_system,
                    "component": link.target_component,
                    "autopilot": int(heartbeat.autopilot),
                    "vehicleType": int(heartbeat.type)
                }
                self.error = None
            while True:
                message = link.recv_match(blocking=True, timeout=1)
                if message is None:
                    continue
                self.record(message)
        except Exception as error:  # Kept visible through health endpoint.
            with self.lock:
                self.ready = False
                self.error = str(error)

    def record(self, message):
        kind = message.get_type()
        now = time.time()
        update = {"receivedAt": now, "message": kind}
        if kind == "LOCAL_POSITION_NED":
            update.update(x=message.x, y=message.y, z=message.z, vx=message.vx, vy=message.vy, vz=message.vz, altitude=max(0.0, -message.z))
        elif kind == "ATTITUDE":
            update.update(roll=message.roll, pitch=message.pitch, yaw=message.yaw, heading=math.degrees(message.yaw), attitude=math.degrees(max(abs(message.roll), abs(message.pitch))))
        elif kind == "SYS_STATUS":
            update.update(battery=max(0.0, min(100.0, message.battery_remaining)), voltageV=message.voltage_battery / 1000.0)
        elif kind == "VFR_HUD":
            update.update(groundSpeed=message.groundspeed, climb=message.climb, heading=message.heading, altitude=message.alt)
        else:
            return
        with self.lock:
            self.telemetry.update(update)

    def inject_failure(self, fault: str, active: bool):
        if not self.ready or self.link is None:
            return {"accepted": False, "reason": "PX4 link is not ready."}
        mappings = {
            "gnss_drift": ("MAV_FAILURE_UNIT_SENSOR_GPS", "MAV_FAILURE_TYPE_WRONG"),
            "sensor_dropout": ("MAV_FAILURE_UNIT_SENSOR_GPS", "MAV_FAILURE_TYPE_OFF")
        }
        if fault not in mappings:
            return {"accepted": False, "reason": f"{fault} requires a Gazebo/world adapter and is not mapped to MAV_CMD_INJECT_FAILURE."}
        unit_name, type_name = mappings[fault]
        try:
            unit = getattr(mavutil.mavlink, unit_name)
            failure_type = getattr(mavutil.mavlink, type_name) if active else getattr(mavutil.mavlink, "MAV_FAILURE_TYPE_OK")
            self.link.mav.command_long_send(
                self.link.target_system,
                self.link.target_component,
                getattr(mavutil.mavlink, "MAV_CMD_INJECT_FAILURE"),
                0,
                unit,
                failure_type,
                0, 0, 0, 0, 0
            )
            return {"accepted": True, "fault": fault, "active": active}
        except Exception as error:
            return {"accepted": False, "reason": str(error)}


def handler_factory(state: BridgeState):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def read_json(self):
            length = min(int(self.headers.get("content-length", "0")), 128_000)
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            if self.path == "/health":
                self.send_json(200, state.snapshot())
            elif self.path == "/telemetry":
                self.send_json(200, state.snapshot()["telemetry"])
            else:
                self.send_json(404, {"error": "Not found"})

        def do_POST(self):
            if self.path == "/session":
                payload = self.read_json()
                with state.lock:
                    state.session = {"seed": payload.get("seed"), "scenario": payload.get("scenario"), "startedAt": time.time()}
                self.send_json(202, {"accepted": True, "benchSafe": True})
            elif self.path == "/fault":
                payload = self.read_json()
                result = state.inject_failure(str(payload.get("fault", "")), bool(payload.get("active", True)))
                self.send_json(202 if result["accepted"] else 422, result)
            else:
                self.send_json(404, {"error": "Not found"})

        def log_message(self, pattern, *args):
            print(f"[vidyut-px4] {self.address_string()} {pattern % args}")

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--connection", default="udp:127.0.0.1:14550", help="pymavlink connection string")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    state = BridgeState(args.connection)
    threading.Thread(target=state.connect_loop, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), handler_factory(state))
    print(f"VIDYUT PX4 bridge listening at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
