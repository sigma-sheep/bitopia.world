import { describe, it, expect } from "vitest";
import { readBalances } from "./balances";

// A minimal stand-in for viem's PublicClient: just the two reads we use.
function fakeClient(opts: {
  usdc?: bigint;
  eth?: bigint;
  throwOn?: "usdc" | "eth";
}) {
  return {
    async readContract() {
      if (opts.throwOn === "usdc") throw new Error("rpc down");
      return opts.usdc ?? 0n;
    },
    async getBalance() {
      if (opts.throwOn === "eth") throw new Error("rpc down");
      return opts.eth ?? 0n;
    },
  };
}

const ADDR = "0x1111111111111111111111111111111111111111" as const;

describe("readBalances", () => {
  it("formats USDC at 6 decimals and ETH at 18 decimals", async () => {
    const client = fakeClient({ usdc: 12_500_000n, eth: 4_000_000_000_000_000n });
    const out = await readBalances(client, ADDR);
    expect(out).toEqual({ usdc: "12.5", eth: "0.004" });
  });

  it("returns a dash for each balance when the RPC read fails", async () => {
    const client = fakeClient({ throwOn: "usdc" });
    const out = await readBalances(client, ADDR);
    expect(out).toEqual({ usdc: "—", eth: "—" });
  });
});
