import type { Vec2 } from "shared/types";
import type { FloorPattern } from "./pattern";

// A single walkable floor tile. 1×1 footprint, 0.25 tall. Floors are always
// walkable — that's intrinsic, so it's a constant, not a constructor arg.
// Deliberately shares no base class with WallTile: they only *look* alike (both
// boxes), which lives in the render layer's makeBox helper, not in inheritance.
export class FloorTile {
  static readonly SIZE = { w: 1, h: 0.25, d: 1 } as const;
  readonly walkable = true;

  constructor(
    public readonly pos: Vec2, // tile center on the ground plane (x, z via Vec2.x/y)
    public readonly pattern: FloorPattern,
  ) {}
}
