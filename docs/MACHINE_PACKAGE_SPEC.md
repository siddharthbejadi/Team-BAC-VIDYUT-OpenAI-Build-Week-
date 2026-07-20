# VIDYUT machine package v2

`vidyut.machine.v2` is the normalized contract between engineering sources and the test executor.

## Accepted prototype inputs

| Input | Values imported | Values that still need confirmation |
|---|---|---|
| VIDYUT JSON | Complete schema | Any fields marked unconfirmed |
| URDF | Links, joints, parent/child topology, limits, mass/inertia fields, collision type | Mesh files, frames, materials, total physical fidelity |
| SDF | Model, links, joints, mass, collision presence | Plugins, sensor models, referenced meshes, backend coefficients |
| STEP/STP | File/product metadata, units, assembly placeholder | Collision mesh, joints, mass, centre of mass, inertia; no wiring is inferred |
| KiCad XML netlist | References, values, footprints, nets and pin connections | Voltage/current ratings, pin capabilities, board-level details |
| PDF and other reference files | File name and provenance | Structured values must be entered or researched separately |

ZIP packages are recorded but not extracted by the dependency-free browser prototype. Select the package contents together in the upload picker.

## Core structure

```json
{
  "schema": "vidyut.machine.v2",
  "version": 2,
  "id": "machine-id",
  "name": "Machine name",
  "family": "aerial",
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
  "confirmations": []
}
```

## Pre-run checks

The current readiness engine blocks execution for missing mass/components, incompatible voltage, reversed polarity patterns, missing component/pin references, duplicate input drivers, UART TX-to-TX or RX-to-RX, invalid PWM frequency, I2C address conflicts, exceeded source current, and unpowered declared loads. It warns for unconfirmed geometry, physical properties, researched components, and missing controller interfaces.

These checks validate declared data. They do not replace a schematic review, electrical rule check, or physical bench safety procedure.
