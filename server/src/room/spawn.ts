import type { Vec2 } from "shared/types";

// Keep spawns off the perimeter walls so characters never overlap them.
const MARGIN = 2;

// A random floor position inset from the walls. The server picks this so every
// client agrees on where each entity stands. `rng` is injectable for tests.
export function randomSpawn(width: number, height: number, rng: () => number = Math.random): Vec2 {
  const span = (size: number) => MARGIN + Math.round(rng() * (size - 2 * MARGIN));
  return { x: span(width), y: span(height) };
}

// Clamp a requested ground position into the walkable inset (same MARGIN as
// spawns). Click targets are arbitrary floats from a raycast, so this clamps
// without rounding — a click near or through a wall lands on the nearest legal
// spot rather than being rejected.
export function clampToFloor(pos: Vec2, width: number, height: number): Vec2 {
  const clamp = (v: number, size: number) => Math.min(Math.max(v, MARGIN), size - MARGIN);
  return { x: clamp(pos.x, width), y: clamp(pos.y, height) };
}
