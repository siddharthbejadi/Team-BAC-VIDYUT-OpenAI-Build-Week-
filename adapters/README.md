# VIDYUT backend adapters

VIDYUT owns test intent, readiness, reproducibility, and evidence. Physics remains in a versioned external backend.

- `px4-gazebo/` provides the bench-safe PX4/MAVLink discovery and telemetry boundary.
- The application exports `vidyut.backend-package.v1`, including an FMI 3.0 co-simulation variable contract and a cross-domain ASAM OpenSCENARIO concept mapping.

The exported FMI section is an adapter contract, not an FMU. The OpenSCENARIO section is not a conformance-certified `.osc` file. This distinction is intentional: a production adapter must be tested against the exact FMU or ASAM tooling selected by the engineering team.
