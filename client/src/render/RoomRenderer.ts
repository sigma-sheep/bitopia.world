import * as THREE from "three";
import type { Facing } from "shared/types";
import type { Room } from "../world/Room";
import { FloorTile } from "../world/FloorTile";
import { WallTile } from "../world/WallTile";
import { makeBox } from "./makeBox";

// The room model has all four walls (the server blocks movement on every side),
// but with the fixed iso camera looking in from the +X/+Z corner the S and E
// walls sit between the camera and the interior and would occlude it. Classic
// isometric trick: render only the two far "backdrop" walls.
const VISIBLE_WALL_FACINGS: readonly Facing[] = ["N", "W"];

// Reads the world model and emits meshes. The model knows nothing about three.js;
// this is the only direction the dependency points.
//
// One mesh per tile keeps this readable for the scaffold. When tile counts grow
// enough to matter, batch identical patterns with THREE.InstancedMesh here —
// nothing outside this function needs to change.
export function buildRoom(room: Room): THREE.Group {
  const group = new THREE.Group();

  for (const tile of room.floor.tiles) {
    // Floor pattern maps directly: top surface + thin side lip.
    const mesh = makeBox(FloorTile.SIZE, { top: tile.pattern.top, side: tile.pattern.side });
    // Vec2 maps to the ground plane: pos.x → world X, pos.y → world Z.
    mesh.position.set(tile.pos.x, FloorTile.SIZE.h / 2, tile.pos.y);
    group.add(mesh);
  }

  for (const tile of room.walls.tiles) {
    if (!VISIBLE_WALL_FACINGS.includes(tile.facing)) continue;
    // Wall has no meaningful top, so its face color is used for every face.
    const mesh = makeBox(WallTile.SIZE, { top: tile.pattern.face, side: tile.pattern.face });
    mesh.position.set(tile.pos.x, WallTile.SIZE.h / 2, tile.pos.y);
    // E/W walls run along Z, so rotate their 5-unit span a quarter turn.
    if (tile.facing === "E" || tile.facing === "W") {
      mesh.rotation.y = Math.PI / 2;
    }
    group.add(mesh);
  }

  return group;
}
