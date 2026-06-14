import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Vec2 } from "shared/types";
import { FloorTile } from "../world/FloorTile";
import { makeBox } from "./makeBox";

// The colors a character can spawn with.
const PALETTE = ["red", "yellow", "green", "orange", "pink", "black", "white"] as const;

// A floating nameplate (ENS name, or short address fallback — Entity.displayName)
// shown above an avatar. Drawn to a canvas and shown as a Sprite so it always
// faces the camera; depthTest is off so the name stays legible through walls and
// other avatars. The texture is in pixels; the on-screen size is sprite.scale in
// world units, keeping the canvas aspect ratio so text isn't stretched.
// The ENS parent everyone's subname lives under (see UsernameGate). Stripped
// from nameplates so "alice.bitopiaworld.eth" reads as just "alice"; short
// address fallbacks (0x…) have no suffix and pass through unchanged.
const ENS_PARENT_SUFFIX = ".bitopiaworld.eth";

function shortName(displayName: string): string {
  return displayName.endsWith(ENS_PARENT_SUFFIX)
    ? displayName.slice(0, -ENS_PARENT_SUFFIX.length)
    : displayName;
}

function makeNameLabel(displayName: string): THREE.Sprite {
  const text = shortName(displayName);
  const fontPx = 64;
  const padX = 24;
  const padY = 12;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  ctx.font = `${fontPx}px sans-serif`;
  canvas.width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  canvas.height = fontPx + padY * 2;

  // Resizing the canvas resets the 2d context, so re-set the font before drawing.
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter; // no mipmaps → crisp text at this size
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);

  const worldHeight = 0.9; // a touch under one tile tall
  sprite.scale.set(worldHeight * (canvas.width / canvas.height), worldHeight, 1);
  // Sit just above the box top (box is SIZE.h tall, centered on the mesh).
  sprite.position.set(0, Character.SIZE.h / 2 + 0.7, 0);
  sprite.renderOrder = 999; // with depthTest off, draw last so it's never hidden
  return sprite;
}

// A character in the world — a player or agent avatar. Just a box for now.
//
// Render-side, and it earns a class (unlike FloorTile/WallTile) because it
// changes over time: it owns a mesh and moves. The authoritative position will
// come from the server (shared Entity); this class is how that state becomes
// something on screen. Reuses makeBox so cubes still come from one place.
export class Character {
  static readonly SIZE = { w: 1, h: 3, d: 1 } as const;

  // Glide speed in world units/sec. Tiles are 1 unit and the room is 20×20, so
  // ~10 u/s crosses it in ~2s — a snappy glide that still reads as movement.
  private static readonly SPEED = 10;

  static randomColor(): string {
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    console.log("color", color);
    return color;
  }

  readonly mesh: THREE.Mesh;
  private readonly border: LineMaterial;
  // Glide destination on the ground plane; null when standing still.
  private target: Vec2 | null = null;

  constructor(
    public readonly id: string,
    color: string,
    pos: Vec2,
    name: string,
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

    // Nameplate above the head — a child of the mesh, so it follows every move.
    this.mesh.add(makeNameLabel(name));

    this.setPosition(pos);
  }

  // Stand the character on the floor at a ground position (Vec2.x → world X,
  // Vec2.y → world Z); its base rests on the floor's top surface. Instant —
  // cancels any in-flight glide (used for spawn and snapshots).
  setPosition(pos: Vec2): void {
    this.target = null;
    this.mesh.position.set(pos.x, this.groundY(), pos.y);
  }

  // Request a smooth glide to a ground position; update() does the interpolation.
  // A new target overrides any in-flight glide, so rapid clicks retarget cleanly.
  moveTo(pos: Vec2): void {
    this.target = pos;
  }

  // Advance the glide by dt seconds: move toward the target at SPEED u/s on the
  // X/Z plane (Y stays fixed on the floor). Snap and stop when within one step.
  // No-op when idle, so the render loop can call this for every character.
  update(dt: number): void {
    if (!this.target) return;
    const p = this.mesh.position;
    const dx = this.target.x - p.x;
    const dz = this.target.y - p.z;
    const dist = Math.hypot(dx, dz);
    const step = Character.SPEED * dt;
    if (dist <= step || dist === 0) {
      p.set(this.target.x, this.groundY(), this.target.y);
      this.target = null;
      return;
    }
    p.x += (dx / dist) * step;
    p.z += (dz / dist) * step;
  }

  // Fixed Y for the character's center: base resting on the floor's top surface.
  private groundY(): number {
    return FloorTile.SIZE.h + Character.SIZE.h / 2;
  }

  // The border's 2px width is measured against this resolution; keep it in sync
  // with the canvas size (call on create and on every resize).
  setResolution(width: number, height: number): void {
    this.border.resolution.set(width, height);
  }
}
