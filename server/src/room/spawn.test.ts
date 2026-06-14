import { describe, it, expect } from "vitest";
import { randomSpawn, clampToFloor } from "./spawn";

describe("randomSpawn", () => {
  it("stays inside the grid margins", () => {
    // rng at the extremes maps to the inset edges, never into the walls.
    expect(randomSpawn(20, 20, () => 0)).toEqual({ x: 2, y: 2 });
    expect(randomSpawn(20, 20, () => 0.999999)).toEqual({ x: 18, y: 18 });
  });

  it("is deterministic for a given rng", () => {
    const rng = () => 0.5;
    expect(randomSpawn(20, 20, rng)).toEqual(randomSpawn(20, 20, rng));
  });
});

describe("clampToFloor", () => {
  it("passes through positions already inside the inset", () => {
    expect(clampToFloor({ x: 10, y: 5.5 }, 20, 20)).toEqual({ x: 10, y: 5.5 });
  });

  it("clamps positions past the walls to the inset edge", () => {
    expect(clampToFloor({ x: -3, y: 99 }, 20, 20)).toEqual({ x: 2, y: 18 });
  });
});
