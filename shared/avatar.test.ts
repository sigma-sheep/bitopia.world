import { describe, it, expect } from "vitest";
import { avatarSeedToColor } from "./avatar";

describe("avatarSeedToColor", () => {
  it("is deterministic for the same seed", () => {
    expect(avatarSeedToColor("0xabc")).toBe(avatarSeedToColor("0xabc"));
  });
  it("returns a 6-digit hex color", () => {
    expect(avatarSeedToColor("0xabc")).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("differs for different seeds", () => {
    expect(avatarSeedToColor("0xabc")).not.toBe(avatarSeedToColor("0xdef"));
  });
});
