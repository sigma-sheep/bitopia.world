import * as THREE from "three";

// Dimensions of the room. The floor is a 30x30 slab; both walls are 1 unit
// thick and 15 units tall, standing on top of the floor's top face (y = 0).
export const FLOOR_SIZE = 30;
export const WALL_HEIGHT = 15;
export const THICKNESS = 1;

// Each slab is a real (1-unit-thick) box so an uploaded image can later be
// mapped onto its surface. For now every slab uses a wireframe material; to
// texture a slab later, swap its `.material` for a
// `MeshStandardMaterial({ map: texture })` — the BoxGeometry UVs already work.
function slab(width, height, depth, position, color) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y, position.z);
  return mesh;
}

/**
 * Builds the isometric room: a floor plus a back-left and back-right wall.
 * Returns a Group so the whole room can be added/removed/positioned at once.
 *
 * Layout (Three.js Y is up; floor lies in the XZ plane):
 *   - Floor top face sits at y = 0, spanning x/z from -15..15.
 *   - The back corner of the room is at (-15, -15) in XZ; the room opens
 *     toward the camera (which looks in from +x/+y/+z).
 *   - Walls sit on the floor (base y = 0, top y = 15) with their thickness
 *     turned inward (centers at ±14.5) so they meet flush at the back corner.
 */
export function createRoom() {
  const room = new THREE.Group();
  room.name = "room";

  const half = FLOOR_SIZE / 2; // 15
  const wallY = WALL_HEIGHT / 2; // 7.5 -> base on floor top, top at y=15
  const inset = half - THICKNESS / 2; // 14.5 -> thickness turned inward

  // Floor: 30 x 1 x 30, top face at y = 0.
  const floor = slab(
    FLOOR_SIZE,
    THICKNESS,
    FLOOR_SIZE,
    { x: 0, y: -THICKNESS / 2, z: 0 },
    0x6ca0dc
  );
  floor.name = "floor";

  // Back wall: runs along X at the back edge (z = -15).
  const backWall = slab(
    FLOOR_SIZE,
    WALL_HEIGHT,
    THICKNESS,
    { x: 0, y: wallY, z: -inset },
    0xdc8a6c
  );
  backWall.name = "wall-back";

  // Left wall: runs along Z at the left edge (x = -15).
  const leftWall = slab(
    THICKNESS,
    WALL_HEIGHT,
    FLOOR_SIZE,
    { x: -inset, y: wallY, z: 0 },
    0x8adc6c
  );
  leftWall.name = "wall-left";

  room.add(floor, backWall, leftWall);
  return room;
}
