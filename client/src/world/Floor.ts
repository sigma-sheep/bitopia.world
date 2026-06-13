import type { FloorPattern } from "./pattern";
import { FloorTile } from "./FloorTile";

// The walkable surface: many FloorTiles laid on a grid. Vec2 here is a
// ground-plane coordinate (x = world X, y = world Z).
export class Floor {
  constructor(public readonly tiles: FloorTile[]) {}

  // Build a width×height grid of unit tiles, each centered in its cell.
  static grid(width: number, height: number, pattern: FloorPattern): Floor {
    const tiles: FloorTile[] = [];
    for (let gx = 0; gx < width; gx++) {
      for (let gz = 0; gz < height; gz++) {
        tiles.push(new FloorTile({ x: gx + 0.5, y: gz + 0.5 }, pattern));
      }
    }
    return new Floor(tiles);
  }
}
