import { describe, it, expect } from "vitest";
import { Room } from "./Room";

describe("Room.grid(20, 20)", () => {
  const room = Room.grid(20, 20);

  it("has 400 floor tiles (20×20)", () => {
    expect(room.floor.tiles).toHaveLength(400);
  });

  it("has 16 wall segments (4 per edge × 4 edges)", () => {
    expect(room.walls.tiles).toHaveLength(16);
  });

  it("every floor tile is walkable", () => {
    expect(room.floor.tiles.every((t) => t.walkable)).toBe(true);
  });

  it("every wall segment blocks", () => {
    expect(room.walls.tiles.every((t) => t.blocks)).toBe(true);
  });

  it("places a floor tile centered in the (0,0) cell", () => {
    const corner = room.floor.tiles.find((t) => t.pos.x === 0.5 && t.pos.y === 0.5);
    expect(corner).toBeDefined();
  });

  it("covers all four edges with walls", () => {
    const facings = new Set(room.walls.tiles.map((t) => t.facing));
    expect([...facings].sort()).toEqual(["E", "N", "S", "W"]);
  });
});
