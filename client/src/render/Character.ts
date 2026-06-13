import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Vec2 } from "shared/types";
import { FloorTile } from "../world/FloorTile";
import { makeBox } from "./makeBox";

// The colors a character can spawn with.
const PALETTE = ["red", "yellow", "green", "orange", "pink", "black", "white"] as const;

// A character in the world — a player or agent avatar. Just a box for now.
//
// Render-side, and it earns a class (unlike FloorTile/WallTile) because it
// changes over time: it owns a mesh and moves. The authoritative position will
// come from the server (shared Entity); this class is how that state becomes
// something on screen. Reuses makeBox so cubes still come from one place.
export class Character {
  static readonly SIZE = { w: 1, h: 3, d: 1 } as const;

  static randomColor(): string {
    return PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  readonly mesh: THREE.Mesh;
  private readonly border: LineMaterial;

  constructor(
    public readonly id: string,
    color: string,
    pos: Vec2,
  ) {
    this.mesh = makeBox(Character.SIZE, { top: color, side: color });

    // A bold 2px border along the box edges. Plain LineBasicMaterial.linewidth
    // is ignored by WebGL (always 1px), so this uses fat lines — their width is
    // in screen pixels, tracked against a resolution (see setResolution). The
    // border is a child of the mesh, so it follows the character automatically.
    const edges = new THREE.EdgesGeometry(this.mesh.geometry);
    const borderGeometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
    this.border = new LineMaterial({ color: 0x000000, linewidth: 2 });
    this.mesh.add(new LineSegments2(borderGeometry, this.border));

    this.setPosition(pos);
  }

  // Stand the character on the floor at a ground position (Vec2.x → world X,
  // Vec2.y → world Z); its base rests on the floor's top surface.
  setPosition(pos: Vec2): void {
    const floorTop = FloorTile.SIZE.h;
    this.mesh.position.set(pos.x, floorTop + Character.SIZE.h / 2, pos.y);
  }

  // The border's 2px width is measured against this resolution; keep it in sync
  // with the canvas size (call on create and on every resize).
  setResolution(width: number, height: number): void {
    this.border.resolution.set(width, height);
  }
}
