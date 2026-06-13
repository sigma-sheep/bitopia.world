import type { WallPattern } from "./pattern";
import { WallTile } from "./WallTile";

// The enclosing walls: WallTiles placed along the room's four edges. Each
// segment is WallTile.SIZE.w wide, so an edge of length L holds L / w segments.
export class Wall {
  constructor(public readonly tiles: WallTile[]) {}

  // Place 5-wide segments around the perimeter of a width×height room.
  // N/S edges run along X; E/W edges run along Z (renderer rotates those).
  static perimeter(width: number, height: number, pattern: WallPattern): Wall {
    const span = WallTile.SIZE.w;
    const tiles: WallTile[] = [];

    const segsX = width / span;
    for (let i = 0; i < segsX; i++) {
      const cx = (i + 0.5) * span;
      tiles.push(new WallTile({ x: cx, y: 0 }, "N", pattern));
      tiles.push(new WallTile({ x: cx, y: height }, "S", pattern));
    }

    const segsZ = height / span;
    for (let i = 0; i < segsZ; i++) {
      const cz = (i + 0.5) * span;
      tiles.push(new WallTile({ x: 0, y: cz }, "W", pattern));
      tiles.push(new WallTile({ x: width, y: cz }, "E", pattern));
    }

    return new Wall(tiles);
  }
}
