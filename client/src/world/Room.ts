import { Floor } from "./Floor";
import { Wall } from "./Wall";
import type { FloorPattern, WallPattern } from "./pattern";

// Default surface colors (no image assets). Typed, swappable later.
const FLOOR_PATTERN: FloorPattern = { top: "#6b7a8f", side: "#4a5666" };
const WALL_PATTERN: WallPattern = { face: "#8f8377" };

// The geometric room: a walkable Floor enclosed by Walls. This is the
// render/world model — distinct from the wire-metadata `Room` interface in
// shared/types.ts (id/owner/ENS), which it intentionally does not import.
export class Room {
  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly floor: Floor,
    public readonly walls: Wall,
  ) {}

  static grid(width: number, height: number): Room {
    return new Room(
      width,
      height,
      Floor.grid(width, height, FLOOR_PATTERN),
      Wall.perimeter(width, height, WALL_PATTERN),
    );
  }
}
