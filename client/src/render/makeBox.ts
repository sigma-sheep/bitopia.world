import * as THREE from "three";

type Size = { w: number; h: number; d: number };

// A box's faces, geometry-level. This is NOT a domain Pattern — each tile type
// maps its own pattern onto these faces (floor: top + lip; wall: same color on
// all visible faces since its top is never seen).
type BoxFaces = { top: string; side: string };

// The one place "every tile is a cube" lives. Both FloorTile and WallTile draw
// through here — composition, not a shared base class.
// BoxGeometry's material array is ordered [+X, -X, +Y(top), -Y, +Z, -Z], so the
// top face gets faces.top and the four sides get faces.side.
export function makeBox(size: Size, faces: BoxFaces): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size.w, size.h, size.d);
  const top = new THREE.MeshStandardMaterial({ color: faces.top });
  const side = new THREE.MeshStandardMaterial({ color: faces.side });
  const materials = [side, side, top, side, side, side];
  return new THREE.Mesh(geometry, materials);
}
