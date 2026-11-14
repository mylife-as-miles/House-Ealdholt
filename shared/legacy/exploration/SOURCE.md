# Exploration provenance and boundaries

The navigation/session implementation is original Crownfall TypeScript. Its reference is Miles's
[Hello World](https://github.com/mylife-as-miles/hello-world) at commit
`03d937d69e8f6670e166395d17b582426d5cfab2`, inspected read-only:

- `packages/world-engine/src/world/layout.ts`: authored route graph and A* principles.
- `packages/world-engine/src/simulation/movement.ts`: distance-budget waypoint travel.
- `packages/world-engine/src/simulation/approach.ts`: approach before interaction.
- `packages/world-engine/src/core/sceneStore.ts`: separating view snapshots from domain state.

No source code or binary assets were copied. Hello World has no root license at that commit; this
record does not relabel its code or third-party assets as MIT. Its town coordinates, social economy,
needs, timers, dialogue, backend and forced timed-arrival behavior are not included.

Crownfall travels only on environment-authored, height/collider-validated routes. Missing navigation
data remains unavailable. World clicks select a nearby safe authored node; they do not create terrain
shortcuts. Cancellation preserves the actual position and known edge. Stalled frames discard excess
elapsed time, pauses accumulate no movement, and arrival requires completing the route. This module
also supports separately labelled fast travel to explicitly allowlisted, validated authored nodes;
it relocates only the selected member and never simulates a walk between disconnected hubs. It
owns intentional travel only; reduced ambient motion must not disable it. Positions and member
selection are ephemeral and cannot change or persist a house, match outcome or member condition.
