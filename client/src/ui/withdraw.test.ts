import { describe, it, expect } from "vitest";
import { withdrawError } from "./withdraw";

const ADDR = "0x1111111111111111111111111111111111111111";

describe("withdrawError", () => {
  it("rejects an empty destination", () => {
    expect(withdrawError("", "5", 10)).toBe("Enter a valid 0x address or ENS name.");
  });

  // The wallet UI surfaces and copies the player's ENS name, so users naturally
  // try to send to one. ENS names are accepted here and resolved on-chain at
  // send time.
  it("accepts an ENS name", () => {
    expect(withdrawError("alice.bitopiaworld.eth", "5", 10)).toBeNull();
  });

  it("accepts a bare .eth name", () => {
    expect(withdrawError("vitalik.eth", "5", 10)).toBeNull();
  });

  it("rejects a bare label with no dot", () => {
    expect(withdrawError("alice", "5", 10)).toBe(
      "Enter a valid 0x address or ENS name.",
    );
  });

  it("rejects a non-positive amount", () => {
    expect(withdrawError(ADDR, "0", 10)).toBe("Enter an amount greater than 0.");
  });

  it("rejects an amount above the balance", () => {
    expect(withdrawError(ADDR, "20", 10)).toBe("Amount exceeds your USDC balance.");
  });

  it("allows a valid send", () => {
    expect(withdrawError(ADDR, "5", 10)).toBeNull();
  });

  it("allows the send when balance is unknown (NaN)", () => {
    expect(withdrawError(ADDR, "5", NaN)).toBeNull();
  });
});
