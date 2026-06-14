import { describe, it, expect } from "vitest";
import { normalizeUsername, validateUsername } from "./username";

describe("normalizeUsername", () => {
  it("lowercases and trims surrounding whitespace", () => {
    expect(normalizeUsername("  Alice  ")).toBe("alice");
  });
  it("leaves an already-normal name unchanged", () => {
    expect(normalizeUsername("golden-flower")).toBe("golden-flower");
  });
});

describe("validateUsername", () => {
  it("accepts a simple lowercase name", () => {
    expect(validateUsername("alice")).toEqual({ ok: true });
  });
  it("accepts digits and internal hyphens", () => {
    expect(validateUsername("agent-007")).toEqual({ ok: true });
  });
  it("rejects names shorter than 3 chars", () => {
    expect(validateUsername("ab").ok).toBe(false);
  });
  it("rejects names longer than 20 chars", () => {
    expect(validateUsername("a".repeat(21)).ok).toBe(false);
  });
  it("rejects uppercase (caller must normalize first)", () => {
    expect(validateUsername("Alice").ok).toBe(false);
  });
  it("rejects disallowed characters", () => {
    expect(validateUsername("alice.eth").ok).toBe(false);
    expect(validateUsername("al_ice").ok).toBe(false);
    expect(validateUsername("emoji😀").ok).toBe(false);
  });
  it("rejects leading or trailing hyphens", () => {
    expect(validateUsername("-alice").ok).toBe(false);
    expect(validateUsername("alice-").ok).toBe(false);
  });
  it("returns a human-readable error message on failure", () => {
    const r = validateUsername("ab");
    expect(r.ok).toBe(false);
    expect(typeof (r as { error: string }).error).toBe("string");
  });
});
