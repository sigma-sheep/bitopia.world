import type { Vec2 } from "shared/types";

// Keep spawns off the perimeter walls so characters never overlap them.
const MARGIN = 2;

// A random floor position inset from the walls. The server picks this so every
// client agrees on where each entity stands. `rng` is injectable for tests.
export function randomSpawn(width: number, height: number, rng: () => number = Math.random): Vec2 {
  const span = (size: number) => MARGIN + Math.round(rng() * (size - 2 * MARGIN));
  return { x: span(width), y: span(height) };
}
