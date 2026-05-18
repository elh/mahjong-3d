# UI

React viewer components and presentation helpers live here. UI code should
consume simulator snapshots and event logs from `src/sim/` instead of owning
game rules.

The 3D table code under `src/ui/three/` is presentation-only. Tile positions,
animations, highlights, and terminal reveals should continue to derive from
replay snapshots/events rather than independent UI state.
