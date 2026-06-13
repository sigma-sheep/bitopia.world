import type { Vec2, Facing } from "shared/types";
import type { WallPattern } from "./pattern";

// A single wall segment. 5 wide, 12 tall, 0.25 thick. Walls always block
// movement (intrinsic constant). Unlike FloorTile, a wall has a `facing` — it
// sits on an edge and its 5-unit span runs along X (N/S) or Z (E/W).
export class WallTile {
  static readonly SIZE = { w: 5, h: 10, d: 0.25 } as const;
  readonly blocks = true;

  constructor(
    public readonly pos: Vec2, // segment center on the ground plane (x, z via Vec2.x/y)
    public readonly facing: Facing, // which edge it guards; drives rotation in the renderer
    public readonly pattern: WallPattern,
  ) {}
}
