import { describe, it, expect } from "vitest";
import { labelhash, namehash, fullName } from "./ensName";

const PARENT = "bitopiaworld.eth";

describe("namehash", () => {
  it("namehash('') is 32 zero bytes (EIP-137 root)", () => {
    expect(namehash("")).toBe("0x" + "00".repeat(32));
  });
  it("matches the canonical 'eth' namehash", () => {
    expect(namehash("eth")).toBe(
      "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"
    );
  });
  it("normalizes case (Bitopiaworld.ETH === bitopiaworld.eth)", () => {
    expect(namehash("Bitopiaworld.ETH")).toBe(namehash("bitopiaworld.eth"));
  });
});

describe("labelhash", () => {
  it("is deterministic for a label", () => {
    expect(labelhash("alice")).toBe(labelhash("alice"));
    expect(labelhash("alice")).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("differs across labels", () => {
    expect(labelhash("alice")).not.toBe(labelhash("bob"));
  });
});

describe("fullName", () => {
  it("joins a label under the parent, lowercased", () => {
    expect(fullName("Alice", PARENT)).toBe("alice.bitopiaworld.eth");
  });
});
