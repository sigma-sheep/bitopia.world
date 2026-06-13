import * as THREE from "three";
// Non-code artifacts live under /assets; `?url` lets Vite serve/hash the image.
import floorTextureUrl from "../../assets/textures/wood-floor.png?url";
import wallTextureUrl from "../../assets/textures/white-decorated-wall.png?url";

// Dimensions of the room. The floor is a 30x30 slab; both walls are 1 unit
// thick and 15 units tall, standing on top of the floor's top face (y = 0).
export const FLOOR_SIZE = 30;
export const WALL_HEIGHT = 15;
export const THICKNESS = 1;

// Each slab is a real (1-unit-thick) box so an image can be mapped onto its
// surface. The caller assigns the textured `.material` after construction; the
// placeholder here is just so the mesh is valid until then.
function slab(width, height, depth, position) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y, position.z);
  return mesh;
}

// Loads an image and returns an unlit material that tiles it WITHOUT distorting
// its aspect ratio. `repeatFor(aspect)` receives the image's width/height ratio
// (read once the image loads) and returns the [x, y] UV repeat to use, so each
// surface can decide how to anchor the texture while keeping it undistorted.
// MeshBasicMaterial is unlit, so textures show at full brightness with no light.
function createTexturedMaterial(url, repeatFor) {
  const material = new THREE.MeshBasicMaterial();
  new THREE.TextureLoader().load(url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    const aspect = texture.image.width / texture.image.height; // ~1.833
    const [x, y] = repeatFor(aspect);
    texture.repeat.set(x, y);
    material.map = texture;
    material.needsUpdate = true;
  });
  return material;
}

// Floor (30x30, square): anchor one copy across the full 30 units in X and tile
// in Z by the image ratio -> planks keep true proportions, no squish.
function createFloorMaterial() {
  return createTexturedMaterial(floorTextureUrl, (aspect) => [1, aspect]);
}

// Wall face is 30 long x 15 tall. Anchor the texture to the full wall HEIGHT
// (repeat.y = 1, so the whole decorative panel + baseboard fits the 15 units)
// and tile horizontally by however much the 30 length needs -> no distortion.
function createWallMaterial() {
  return createTexturedMaterial(wallTextureUrl, (aspect) => [
    FLOOR_SIZE / (WALL_HEIGHT * aspect),
    1,
  ]);
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

  // Floor: 30 x 1 x 30, top face at y = 0. Textured with the wood image
  // (aspect preserved) instead of wireframe.
  const floor = slab(FLOOR_SIZE, THICKNESS, FLOOR_SIZE, {
    x: 0,
    y: -THICKNESS / 2,
    z: 0,
  });
  floor.name = "floor";
  floor.material = createFloorMaterial();

  // Back wall: runs along X at the back edge (z = -15). Textured (aspect
  // preserved) with the decorated-wall image.
  const backWall = slab(FLOOR_SIZE, WALL_HEIGHT, THICKNESS, {
    x: 0,
    y: wallY,
    z: -inset,
  });
  backWall.name = "wall-back";
  backWall.material = createWallMaterial();

  // Left wall: runs along Z at the left edge (x = -15). Same wall texture; a
  // separate material so each wall owns its own texture instance.
  const leftWall = slab(THICKNESS, WALL_HEIGHT, FLOOR_SIZE, {
    x: -inset,
    y: wallY,
    z: 0,
  });
  leftWall.name = "wall-left";
  leftWall.material = createWallMaterial();

  room.add(floor, backWall, leftWall);
  return room;
}
