# VIDYUT machine package v2

`vidyut.machine.v2` is the normalized contract between engineering sources and the test executor.

## Accepted prototype inputs

| Input | Values imported | Values that still need confirmation |
|---|---|---|
| VIDYUT JSON | Complete schema | Any fields marked unconfirmed |
| VIDYUT YAML/YML | Complete schema using a safe subset of YAML | Anchors, aliases, custom tags, and executable YAML are intentionally rejected |
| URDF | Links, joints, parent/child topology, limits, mass/inertia fields, collision type | Mesh files, frames, materials, total physical fidelity |
| Xacro | Static XML that is already directly parseable | Macros, substitutions, and generated content must be expanded before import |
| SDF | Model, links, joints, mass, collision presence | Plugins, sensor models, referenced meshes, backend coefficients |
| STEP/STP | File/product metadata, units, assembly placeholder | Collision mesh, joints, mass, centre of mass, inertia; no wiring is inferred |
| glTF/GLB 2.0 | Scene/node hierarchy, mesh count, and preview metadata | Engineering mass, inertia, joints, collision, and electronics |
| KiCad XML netlist | References, values, footprints, nets and pin connections | Voltage/current ratings, pin capabilities, board-level details |
| PDF and other reference files | File name and provenance | Structured values must be entered or researched separately |

`.vidyut.zip` packages are expanded in the browser. Every entry is path-checked, size-limited, CRC-32 verified, and restricted to stored or deflate compression. Encrypted archives, unsafe paths, nested archives, and oversized packages are rejected. Every imported source receives a SHA-256 provenance hash when the browser supports Web Crypto.

## Core structure

```json
{
  "schema": "vidyut.machine.v2",
  "version": 2,
  "id": "machine-id",
  "name": "Machine name",
  "family": "aerial",
  "identity": { "manufacturer": "", "model": "", "revision": "", "serial": "", "sourceHashes": [] },
  "geometry": { "format": "urdf", "fileName": "machine.urdf", "units": "m", "links": [], "joints": [], "confirmed": false },
  "physical": { "totalMassKg": 1.2, "centerOfMass": [0, 0, 0], "frictionCoefficient": 0.65, "dragCoefficient": 0.9, "confirmed": false },
  "components": [],
  "connections": [],
  "interfaces": [{ "transport": "web-serial", "baudRate": 115200, "protocol": "vidyut.hil.v1", "benchSafe": true }],
  "capabilities": [],
  "faults": [],
  "objective": "...",
  "passRules": [],
  "assumptions": [],
  "confirmations": [],
  "coordinateFrame": { "world": "ENU", "body": "FLU", "angles": "rad", "length": "m" },
  "safety": { "physicalOutputsDisabled": true, "emergencyStopRequired": true, "benchChecklistConfirmed": false },
  "provenance": []
}
```

## Pre-run checks

The current readiness engine blocks execution for missing or duplicate structural fields; invalid mass, inertia, collision, joint, component, pin, voltage, PWM, SPI, UART, I2C, CAN, power, interface, channel-mapping, or safety declarations; and total-mass/link-mass inconsistency. It warns for missing provenance, unconfirmed geometry or physical values, and CAN termination that cannot be established from the manifest.

These checks validate declared data. They do not replace a schematic review, electrical rule check, or physical bench safety procedure.
