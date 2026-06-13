# S3 Identity, Wallets & ENS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`. Read `2026-06-13-bitopia-00-overview.md` first — Seams are frozen. Work in the `s3-identity` git worktree (off the S0 commit).

**Goal:** Deliver identity + value for bitopia.world: Privy auth (embedded wallets for players, server wallets for agents), ENS subnames for users/rooms/agents (with text records), the USDC→$BTPA on-ramp featuring a Blink deposit widget, and a tx feed where every onchain action surfaces a real Sepolia Etherscan link. Implement the frozen `agentWalletOps` singleton, the socket auth middleware that sets `socket.data.user`, and the create-agent HTTP flow that emits `bus.emitT("agentCreated", …)`.

**Architecture:** Server: `chain/` holds viem clients, gas drip, ENS subname issuance, Privy-backed agent wallet ops, and the create-agent HTTP endpoints; `auth/` holds the socket.io middleware that verifies Privy tokens and lazily provisions users/rooms/ENS/gas. Client: `wallet/` wraps the app in Privy, builds a viem walletClient from the embedded wallet, exposes approve/convert/createAgent helpers, renders the wallet panel (balances + Blink deposit + convert), and the tx feed; `ui/CreateAgentForm.tsx` runs the prepare→onchain→confirm dance. Pure helpers (decimal conversion, drip decision, ENS name/namehash building, Etherscan URL/TxRecord formatting) are TDD-tested; SDK/network calls are wrapped behind small functions with injected clients so they are testable.

**Tech Stack:** TypeScript, Privy (embedded + server wallets), viem, ENS NameWrapper (Sepolia), Blink, React, Vitest.

---

## Day-one de-risk checklist (do BEFORE building around them)

These three are external dependencies the spec flags as risks. Spend the first ~60–90 min confirming them; they change details, not structure.

- [ ] **ENS NameWrapper / parent name.** The parent `bitopiaworld.eth` must be **registered AND wrapped** on Sepolia, owned by the wallet behind `ENS_PARENT_OWNER_KEY` (may equal `DEPLOYER_PRIVATE_KEY`). Confirm:
  - Sepolia contract addresses for **ENS Registry**, **NameWrapper**, and **Public Resolver** (record them in `server/src/chain/ens.ts` as constants — see Task 4; the values below are the well-known Sepolia deployments, but re-verify on a block explorer before relying on them).
  - Run ONE programmatic subname issuance end-to-end (e.g. `probe.bitopiaworld.eth`) via `NameWrapper.setSubnodeRecord` + resolver `setAddr`/`setText` and view it on the ENS app, BEFORE wiring the UI. If the parent is not wrapped, wrap it (`NameWrapper.wrapETH2LD`) first.
- [ ] **Privy server wallets.** Confirm the `@privy-io/server-auth` package version exposes `walletApi.createWallet({ chainType: "ethereum" })` and a raw-sign / `eth_sendTransaction` path for the server wallet (API surface drifts between versions). Confirm `verifyAuthToken` exists for verifying the handshake token. If method names differ, adapt the thin wrappers in Task 5 only (their call sites are isolated).
- [ ] **Blink.** Confirm: the exact Blink SDK package + the env var name (`BLINK_API_KEY` is a placeholder — verify), which **testnet USDC token** Blink delivers, and **where Blink pulls source USDC from** on testnet. **Documented fallback (Task 11):** if Blink's testnet on-ramp isn't ready, render a "Faucet: mint 10 test USDC" button that calls `MockUSDC.mint(self, 10e6)` (S1 deploys MockUSDC as the `USDC` in `deployments/sepolia.json`). This keeps the convert→create→tip loop unblocked regardless of Blink status. Build the convert flow against the resulting USDC balance either way.

---

## Assumptions & integration notes

- **S0 done:** `shared/types.ts`, `shared/protocol.ts`, `server/src/db/db.ts` (`openDb`), `server/src/config.ts`, `server/src/socketTypes.ts`, `server/src/bus.ts`, `client/src/net/socket.ts` (`connectSocket(privyToken?)`), `client/src/App.tsx` shell all exist.
- **S1 will publish** `contracts/deployments/sepolia.json` (`{ chainId, BTPA, BitopiaCore, USDC }`) and ABIs under `shared/abi/*`. We code against those paths now; they may be filled at integration. To keep this stream's tests green standalone, this plan **vendors minimal ABI fragments** for the calls we make (`BitopiaCore.convert/createAgent`, ERC-20 `approve/balanceOf/transfer`) inside `server/src/chain/abi.ts` and `client/src/wallet/abi.ts`, and **reads addresses from `deployments/sepolia.json` at runtime with a typed loader** that throws a clear error if the file is absent. At integration, the vendored fragments and the published `shared/abi/*` must agree (they're the same frozen interface from the overview).
- **Owned paths only:** `server/src/auth/**`, `server/src/chain/**`, `client/src/wallet/**`, `client/src/ui/CreateAgentForm.tsx`. Plus exactly **one import + one call line each** in `server/src/index.ts` (`registerAuth`, `registerChain`) and `client/src/App.tsx` (mount `<WalletPanel/>`, `<TxFeed/>`, `<CreateAgentForm/>`, wrap in `<AppPrivyProvider/>`). Do not edit any other stream's files.
- **Frozen seams bound here:** `SocketUser`, the auth middleware contract (`socket.data.user`), `AgentWalletOps` + `agentWalletOps` singleton, `TxRecord`, `ServerToClient["tx"]`, `bus.emitT("agentCreated", …)`, the contract interfaces + `deployments/sepolia.json` shape.

---

## Task list (titles)

1. Worktree + deps + chain/client config
2. Pure money helper: `usdcToBtpa` (TDD)
3. Pure ENS helpers: labelhash / namehash / full-name building (TDD)
4. Pure tx helpers: Etherscan URL + `TxRecord` builders (server + client) (TDD)
5. `chain/gas.ts` — `shouldDrip` (TDD) + `dripGas`
6. `chain/clients.ts` — viem public/wallet clients + deployments loader + ABIs
7. `chain/ens.ts` — `ensureSubname` (NameWrapper + resolver)
8. `chain/wallets.ts` — `agentWalletOps` via Privy server SDK
9. `chain/index.ts` — `registerChain`: assign `agentWalletOps` + create-agent endpoints
10. `auth/index.ts` — `registerAuth`: Privy token middleware + getOrCreateUser
11. Client `wallet/` — Privy provider, `useChain`, WalletPanel (Blink + convert), TxFeed
12. Client `ui/CreateAgentForm.tsx` + App wiring + socket token

---

### Task 1: Worktree + deps + chain/client config

**Files:**
- Modify: `server/package.json`, `client/package.json`
- Create: `server/src/chain/`, `server/src/auth/`, `client/src/wallet/` dirs (implicit via first file)

- [ ] **Step 1: Create / enter the worktree** (skip if the orchestrator already created it).

```bash
git worktree add ../bitopia-s3 -b s3-identity s0-foundation
cd ../bitopia-s3
```

- [ ] **Step 2: Add server deps.** Edit `server/package.json` `dependencies` to add `viem` and the Privy server SDK; keep existing entries.

```json
"viem": "^2.21.0",
"@privy-io/server-auth": "^1.18.0"
```

- [ ] **Step 3: Add client deps.** Edit `client/package.json` `dependencies` to add:

```json
"viem": "^2.21.0",
"@privy-io/react-auth": "^2.0.0"
```

(Blink SDK is added in Task 11 once the exact package name is confirmed on day one.)

- [ ] **Step 4: Install.**

Run: `npm install`
Expected: completes with no peer-dependency errors that block install.

- [ ] **Step 5: Commit.**

```bash
git add server/package.json client/package.json package-lock.json
git commit -m "chore(s3): add viem + privy deps for identity stream"
```

---

### Task 2: Pure money helper — `usdcToBtpa`

USDC has 6 decimals, $BTPA has 18; `convert` is 1:1 in human units, so the on-chain amount conversion is `usdc * 1e12`. This helper formats the user's decimal input into the `bigint` USDC amount (6dp) we pass to `convert`, and also exposes the expected BTPA out for display.

**Files:**
- Create: `client/src/wallet/units.ts`, `client/src/wallet/units.test.ts`

- [ ] **Step 1: Failing test `client/src/wallet/units.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { parseUsdc, usdcToBtpa, formatUnitsFixed } from "./units";

describe("parseUsdc", () => {
  it("parses whole USDC to 6dp bigint", () => {
    expect(parseUsdc("10")).toBe(10_000_000n);
  });
  it("parses fractional USDC", () => {
    expect(parseUsdc("1.5")).toBe(1_500_000n);
  });
  it("truncates beyond 6 decimals", () => {
    expect(parseUsdc("1.1234567")).toBe(1_123_456n);
  });
  it("treats empty/invalid as 0", () => {
    expect(parseUsdc("")).toBe(0n);
    expect(parseUsdc("abc")).toBe(0n);
  });
});

describe("usdcToBtpa", () => {
  it("scales 6dp USDC to 18dp BTPA (×1e12)", () => {
    expect(usdcToBtpa(10_000_000n)).toBe(10_000_000_000_000_000_000n); // 10 BTPA
  });
  it("is 1:1 in human units", () => {
    expect(usdcToBtpa(parseUsdc("1"))).toBe(1_000_000_000_000_000_000n);
  });
});

describe("formatUnitsFixed", () => {
  it("formats 18dp bigint to fixed decimals", () => {
    expect(formatUnitsFixed(1_500_000_000_000_000_000n, 18, 2)).toBe("1.50");
  });
  it("formats 6dp USDC", () => {
    expect(formatUnitsFixed(10_000_000n, 6, 2)).toBe("10.00");
  });
  it("formats zero", () => {
    expect(formatUnitsFixed(0n, 18, 2)).toBe("0.00");
  });
});
```

- [ ] **Step 2: Run; expect FAIL** (module missing).

Run: `npx vitest run src/wallet/units.test.ts` (from `client/`)
Expected: FAIL — cannot find `./units`.

- [ ] **Step 3: Implement `client/src/wallet/units.ts`.**

```ts
// USDC = 6 decimals, BTPA = 18 decimals. convert() is 1:1 in human units.

export function parseUsdc(input: string): bigint {
  const s = input.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return 0n;
  const [whole, frac = ""] = s.split(".");
  const frac6 = (frac + "000000").slice(0, 6);
  try {
    return BigInt(whole || "0") * 1_000_000n + BigInt(frac6 || "0");
  } catch {
    return 0n;
  }
}

// 6dp USDC -> 18dp BTPA (1:1 human), i.e. multiply by 1e12.
export function usdcToBtpa(usdc6: bigint): bigint {
  return usdc6 * 1_000_000_000_000n;
}

export function formatUnitsFixed(value: bigint, decimals: number, places: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, places);
  const out = places > 0 ? `${whole}.${fracStr.padEnd(places, "0")}` : `${whole}`;
  return neg ? `-${out}` : out;
}
```

- [ ] **Step 4: Run; expect PASS.**

Run: `npx vitest run src/wallet/units.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit.**

```bash
git add client/src/wallet/units.ts client/src/wallet/units.test.ts
git commit -m "feat(wallet): usdc parsing + usdc->btpa decimal conversion (tested)"
```

---

### Task 3: Pure ENS helpers — labelhash / namehash / full-name building

Used by both `chain/ens.ts` (to compute nodes for NameWrapper/resolver calls) and client display. Implemented in `shared`-style pure form on the server side under `chain/`, plus a tiny client copy for the wallet panel's name building.

**Files:**
- Create: `server/src/chain/ensName.ts`, `server/src/chain/ensName.test.ts`

- [ ] **Step 1: Failing test `server/src/chain/ensName.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { labelhash, namehash, fullName, userLabel, roomLabel } from "./ensName";

const PARENT = "bitopiaworld.eth";

describe("namehash", () => {
  it("namehash('') is 32 zero bytes", () => {
    expect(namehash("")).toBe("0x" + "00".repeat(32));
  });
  it("matches the canonical eth namehash", () => {
    expect(namehash("eth")).toBe(
      "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"
    );
  });
  it("is case-insensitive (normalizes to lowercase)", () => {
    expect(namehash("Bitopiaworld.ETH")).toBe(namehash("bitopiaworld.eth"));
  });
});

describe("labelhash", () => {
  it("hashes a single label deterministically", () => {
    expect(labelhash("alice")).toBe(labelhash("alice"));
    expect(labelhash("alice")).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("differs by label", () => {
    expect(labelhash("alice")).not.toBe(labelhash("bob"));
  });
});

describe("fullName + label builders", () => {
  it("builds a subname under the parent", () => {
    expect(fullName("goldenflower", PARENT)).toBe("goldenflower.bitopiaworld.eth");
  });
  it("userLabel/roomLabel follow the userN convention", () => {
    expect(userLabel(1)).toBe("user1");
    expect(roomLabel(1)).toBe("user1-room");
    expect(fullName(roomLabel(2), PARENT)).toBe("user2-room.bitopiaworld.eth");
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

Run: `npx vitest run src/chain/ensName.test.ts` (from `server/`)
Expected: FAIL — cannot find `./ensName`.

- [ ] **Step 3: Implement `server/src/chain/ensName.ts`** (uses viem's `keccak256`/`toBytes`/`concat` — no network).

```ts
import { keccak256, toBytes, toHex, concat, type Hex } from "viem";

const ZERO_NODE: Hex = ("0x" + "00".repeat(32)) as Hex;

export function labelhash(label: string): Hex {
  return keccak256(toBytes(label.toLowerCase()));
}

// ENS namehash algorithm (EIP-137).
export function namehash(name: string): Hex {
  let node = ZERO_NODE;
  const normalized = name.toLowerCase();
  if (normalized === "") return node;
  const labels = normalized.split(".");
  for (let i = labels.length - 1; i >= 0; i--) {
    node = keccak256(concat([node, labelhash(labels[i])]));
  }
  return node;
}

export function fullName(label: string, parent: string): string {
  return `${label.toLowerCase()}.${parent.toLowerCase()}`;
}

export function userLabel(n: number): string {
  return `user${n}`;
}

export function roomLabel(n: number): string {
  return `user${n}-room`;
}

// Convenience used by ens.ts: the node for a subname under parent.
export function subnameNode(label: string, parent: string): Hex {
  return namehash(fullName(label, parent));
}

export { toHex };
```

- [ ] **Step 4: Run; expect PASS.**

Run: `npx vitest run src/chain/ensName.test.ts`
Expected: PASS. (The `eth` namehash assertion is the canonical EIP-137 value — proves the algorithm is correct.)

- [ ] **Step 5: Commit.**

```bash
git add server/src/chain/ensName.ts server/src/chain/ensName.test.ts
git commit -m "feat(chain): pure ENS labelhash/namehash + subname builders (tested)"
```

---

### Task 4: Pure tx helpers — Etherscan URL + `TxRecord` builders

`TxRecord` is frozen in `shared/types.ts`. We need deterministic builders for both server (backend-performed txs → emitted over socket `tx`) and client (local txs → pushed to the feed). Build one server copy and one client copy of the same pure logic (each stream-owned).

**Files:**
- Create: `server/src/chain/tx.ts`, `server/src/chain/tx.test.ts`
- Create: `client/src/wallet/tx.ts`, `client/src/wallet/tx.test.ts`

- [ ] **Step 1: Failing test `server/src/chain/tx.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { etherscanTxUrl, makeTxRecord } from "./tx";
import type { TxRecord } from "shared/types";

describe("etherscanTxUrl", () => {
  it("builds a Sepolia etherscan tx link", () => {
    expect(etherscanTxUrl("0xabc")).toBe("https://sepolia.etherscan.io/tx/0xabc");
  });
});

describe("makeTxRecord", () => {
  it("builds a TxRecord with url + ts", () => {
    const rec: TxRecord = makeTxRecord("tip", "0xdead", "Golden Flower tipped 1 $BTPA", 1234);
    expect(rec).toEqual({
      kind: "tip",
      hash: "0xdead",
      url: "https://sepolia.etherscan.io/tx/0xdead",
      label: "Golden Flower tipped 1 $BTPA",
      ts: 1234,
    });
  });
  it("defaults ts to Date.now when omitted", () => {
    const before = Date.now();
    const rec = makeTxRecord("convert", "0x1", "Converted");
    expect(rec.ts).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

Run: `npx vitest run src/chain/tx.test.ts` (from `server/`)
Expected: FAIL — cannot find `./tx`.

- [ ] **Step 3: Implement `server/src/chain/tx.ts`.**

```ts
import type { TxRecord } from "shared/types";

export function etherscanTxUrl(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function makeTxRecord(
  kind: TxRecord["kind"],
  hash: string,
  label: string,
  ts: number = Date.now()
): TxRecord {
  return { kind, hash, url: etherscanTxUrl(hash), label, ts };
}
```

- [ ] **Step 4: Run; expect PASS.**

Run: `npx vitest run src/chain/tx.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror on the client.** Create `client/src/wallet/tx.test.ts` (identical tests, import from `./tx`) and `client/src/wallet/tx.ts` (identical body to the server `tx.ts`).

`client/src/wallet/tx.ts`:

```ts
import type { TxRecord } from "shared/types";

export function etherscanTxUrl(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function makeTxRecord(
  kind: TxRecord["kind"],
  hash: string,
  label: string,
  ts: number = Date.now()
): TxRecord {
  return { kind, hash, url: etherscanTxUrl(hash), label, ts };
}
```

`client/src/wallet/tx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { etherscanTxUrl, makeTxRecord } from "./tx";

describe("etherscanTxUrl (client)", () => {
  it("builds a Sepolia etherscan tx link", () => {
    expect(etherscanTxUrl("0xabc")).toBe("https://sepolia.etherscan.io/tx/0xabc");
  });
});

describe("makeTxRecord (client)", () => {
  it("builds a TxRecord with url", () => {
    const rec = makeTxRecord("deposit", "0xfeed", "Deposited 10 USDC", 7);
    expect(rec.url).toBe("https://sepolia.etherscan.io/tx/0xfeed");
    expect(rec.kind).toBe("deposit");
    expect(rec.ts).toBe(7);
  });
});
```

- [ ] **Step 6: Run both; expect PASS.**

Run (client): `npx vitest run src/wallet/tx.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add server/src/chain/tx.ts server/src/chain/tx.test.ts client/src/wallet/tx.ts client/src/wallet/tx.test.ts
git commit -m "feat(chain,wallet): etherscan url + TxRecord builders (tested)"
```

---

### Task 5: `chain/gas.ts` — `shouldDrip` (pure, TDD) + `dripGas`

`dripGas` tops up a fresh wallet with a little Sepolia ETH if its balance is below a threshold, paid by the treasury (deployer) wallet. The decision is a pure helper; the send is wrapped behind an injected wallet client.

**Files:**
- Create: `server/src/chain/gas.ts`, `server/src/chain/gas.test.ts`

- [ ] **Step 1: Failing test `server/src/chain/gas.test.ts`.**

```ts
import { describe, it, expect, vi } from "vitest";
import { shouldDrip, dripGas, DRIP_MIN_WEI, DRIP_AMOUNT_WEI } from "./gas";

describe("shouldDrip", () => {
  it("drips when balance below min", () => {
    expect(shouldDrip(0n, DRIP_MIN_WEI)).toBe(true);
    expect(shouldDrip(DRIP_MIN_WEI - 1n, DRIP_MIN_WEI)).toBe(true);
  });
  it("does not drip when balance >= min", () => {
    expect(shouldDrip(DRIP_MIN_WEI, DRIP_MIN_WEI)).toBe(false);
    expect(shouldDrip(DRIP_MIN_WEI + 1n, DRIP_MIN_WEI)).toBe(false);
  });
});

describe("dripGas", () => {
  const addr = "0x1111111111111111111111111111111111111111" as const;

  it("sends ETH when balance is low", async () => {
    const publicClient = { getBalance: vi.fn().mockResolvedValue(0n) };
    const walletClient = { sendTransaction: vi.fn().mockResolvedValue("0xhash") };
    const hash = await dripGas(addr, { publicClient, walletClient } as any);
    expect(walletClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: addr, value: DRIP_AMOUNT_WEI })
    );
    expect(hash).toBe("0xhash");
  });

  it("skips sending when balance is sufficient", async () => {
    const publicClient = { getBalance: vi.fn().mockResolvedValue(DRIP_MIN_WEI + 1n) };
    const walletClient = { sendTransaction: vi.fn() };
    const hash = await dripGas(addr, { publicClient, walletClient } as any);
    expect(walletClient.sendTransaction).not.toHaveBeenCalled();
    expect(hash).toBeNull();
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

Run: `npx vitest run src/chain/gas.test.ts`
Expected: FAIL — cannot find `./gas`.

- [ ] **Step 3: Implement `server/src/chain/gas.ts`.**

```ts
import { parseEther, type PublicClient, type WalletClient } from "viem";

export const DRIP_MIN_WEI = parseEther("0.002");    // below this, top up
export const DRIP_AMOUNT_WEI = parseEther("0.01");  // amount sent per drip

export function shouldDrip(balance: bigint, min: bigint): boolean {
  return balance < min;
}

export interface DripDeps {
  publicClient: Pick<PublicClient, "getBalance">;
  walletClient: Pick<WalletClient, "sendTransaction">;
}

// Returns the tx hash if it dripped, or null if the wallet already had enough.
export async function dripGas(
  address: `0x${string}`,
  deps: DripDeps
): Promise<string | null> {
  const balance = await deps.publicClient.getBalance({ address });
  if (!shouldDrip(balance, DRIP_MIN_WEI)) return null;
  const hash = await deps.walletClient.sendTransaction({
    to: address,
    value: DRIP_AMOUNT_WEI,
  } as any);
  return hash;
}
```

- [ ] **Step 4: Run; expect PASS.**

Run: `npx vitest run src/chain/gas.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit.**

```bash
git add server/src/chain/gas.ts server/src/chain/gas.test.ts
git commit -m "feat(chain): gas drip with pure shouldDrip decision (tested)"
```

---

### Task 6: `chain/clients.ts` — viem clients + deployments loader + ABIs

Centralizes the Sepolia `publicClient`, the treasury `walletClient` (from `DEPLOYER_PRIVATE_KEY`), the parent-owner account (`ENS_PARENT_OWNER_KEY`, may equal deployer), the deployments loader, and the minimal ABI fragments.

**Files:**
- Create: `server/src/chain/abi.ts`, `server/src/chain/deployments.ts`, `server/src/chain/deployments.test.ts`, `server/src/chain/clients.ts`

- [ ] **Step 1: Create `server/src/chain/abi.ts`** (minimal fragments matching the frozen contract interfaces; ERC-20 subset + ENS calls used by ens.ts).

```ts
import type { Abi } from "viem";

export const erc20Abi: Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export const bitopiaCoreAbi: Abi = [
  { type: "function", name: "convert", stateMutability: "nonpayable",
    inputs: [{ name: "usdcAmount", type: "uint256" }], outputs: [] },
  { type: "function", name: "createAgent", stateMutability: "nonpayable",
    inputs: [{ name: "agentWallet", type: "address" }], outputs: [] },
  { type: "function", name: "CREATE_FEE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "AGENT_SEED", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "event", name: "AgentFunded", inputs: [
    { name: "owner", type: "address", indexed: true },
    { name: "agentWallet", type: "address", indexed: true },
    { name: "seed", type: "uint256", indexed: false },
  ] },
] as const;

// ENS NameWrapper + Public Resolver (subset we call).
export const nameWrapperAbi: Abi = [
  { type: "function", name: "setSubnodeRecord", stateMutability: "nonpayable",
    inputs: [
      { name: "parentNode", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
      { name: "fuses", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "node", type: "bytes32" }] },
] as const;

export const resolverAbi: Abi = [
  { type: "function", name: "setAddr", stateMutability: "nonpayable",
    inputs: [{ name: "node", type: "bytes32" }, { name: "addr", type: "address" }], outputs: [] },
  { type: "function", name: "setText", stateMutability: "nonpayable",
    inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }, { name: "value", type: "string" }],
    outputs: [] },
] as const;
```

- [ ] **Step 2: Failing test `server/src/chain/deployments.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { parseDeployments } from "./deployments";

describe("parseDeployments", () => {
  it("parses a valid deployments json", () => {
    const d = parseDeployments(
      JSON.stringify({ chainId: 11155111, BTPA: "0x1", BitopiaCore: "0x2", USDC: "0x3" })
    );
    expect(d.BitopiaCore).toBe("0x2");
    expect(d.USDC).toBe("0x3");
  });
  it("throws a clear error when a field is missing", () => {
    expect(() => parseDeployments(JSON.stringify({ chainId: 1 }))).toThrow(/deployments/i);
  });
});
```

- [ ] **Step 3: Run; expect FAIL.**

Run: `npx vitest run src/chain/deployments.test.ts`
Expected: FAIL — cannot find `./deployments`.

- [ ] **Step 4: Implement `server/src/chain/deployments.ts`.**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Deployments {
  chainId: number;
  BTPA: `0x${string}`;
  BitopiaCore: `0x${string}`;
  USDC: `0x${string}`;
}

export function parseDeployments(json: string): Deployments {
  const d = JSON.parse(json);
  for (const k of ["BTPA", "BitopiaCore", "USDC"] as const) {
    if (typeof d[k] !== "string") {
      throw new Error(`Invalid deployments json: missing "${k}". Did S1 publish contracts/deployments/sepolia.json?`);
    }
  }
  return d as Deployments;
}

// S1 writes contracts/deployments/sepolia.json. Resolve from this file's location.
const here = dirname(fileURLToPath(import.meta.url));
const DEPLOYMENTS_PATH = join(here, "../../../contracts/deployments/sepolia.json");

let cached: Deployments | null = null;
export function loadDeployments(path: string = DEPLOYMENTS_PATH): Deployments {
  if (cached) return cached;
  cached = parseDeployments(readFileSync(path, "utf8"));
  return cached;
}
```

- [ ] **Step 5: Run; expect PASS.**

Run: `npx vitest run src/chain/deployments.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `server/src/chain/clients.ts`** (no test — thin SDK wiring; verified at integration).

```ts
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "../config.js";

function normKey(k: string): Hex {
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(config.sepoliaRpcUrl),
});

// Treasury / deployer wallet: gas drip + (default) ENS parent owner.
export const treasuryAccount = config.deployerKey
  ? privateKeyToAccount(normKey(config.deployerKey))
  : undefined;

export const treasuryClient = treasuryAccount
  ? createWalletClient({ account: treasuryAccount, chain: sepolia, transport: http(config.sepoliaRpcUrl) })
  : undefined;

// ENS parent-name owner (may equal the treasury key).
export const ensOwnerAccount = (config.ensParentOwnerKey || config.deployerKey)
  ? privateKeyToAccount(normKey(config.ensParentOwnerKey || config.deployerKey))
  : undefined;

export const ensOwnerClient = ensOwnerAccount
  ? createWalletClient({ account: ensOwnerAccount, chain: sepolia, transport: http(config.sepoliaRpcUrl) })
  : undefined;
```

- [ ] **Step 7: Typecheck.**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: no errors in `chain/clients.ts` / `chain/abi.ts` / `chain/deployments.ts`.

- [ ] **Step 8: Commit.**

```bash
git add server/src/chain/abi.ts server/src/chain/deployments.ts server/src/chain/deployments.test.ts server/src/chain/clients.ts
git commit -m "feat(chain): viem clients + deployments loader + minimal ABIs (tested)"
```

---

### Task 7: `chain/ens.ts` — `ensureSubname` (NameWrapper + resolver)

Issues `label.bitopiaworld.eth` on Sepolia by calling `NameWrapper.setSubnodeRecord` (owner=recipient, resolver=public resolver), then `resolver.setAddr` + `resolver.setText` for each record. Paid by the parent-owner wallet. The node math + record map building are pure (tested); the writes are wrapped behind an injected wallet client.

> **Sepolia constants — VERIFY day one (Task 0).** Public Resolver and NameWrapper addresses below are the well-known Sepolia ENS deployments; re-check on a block explorer. If wrong, only these two constants change.

**Files:**
- Create: `server/src/chain/ens.ts`, `server/src/chain/ens.test.ts`

- [ ] **Step 1: Failing test `server/src/chain/ens.test.ts`** (pure record-building + the orchestration with injected client).

```ts
import { describe, it, expect, vi } from "vitest";
import { buildTextRecords, ensureSubname } from "./ens";
import { namehash } from "./ensName";

describe("buildTextRecords", () => {
  it("drops undefined values", () => {
    expect(buildTextRecords({ avatar: "x", owner: undefined, description: "d" })).toEqual([
      ["avatar", "x"],
      ["description", "d"],
    ]);
  });
  it("returns empty for no records", () => {
    expect(buildTextRecords({})).toEqual([]);
  });
});

describe("ensureSubname", () => {
  const owner = "0xaaaa000000000000000000000000000000000000" as const;

  it("issues subname then sets addr + each text record", async () => {
    const writes: any[] = [];
    const walletClient = {
      writeContract: vi.fn(async (args: any) => {
        writes.push(args.functionName);
        return "0x" + writes.length.toString().padStart(64, "0");
      }),
    };
    const publicClient = { waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }) };

    const result = await ensureSubname(
      "goldenflower",
      owner,
      { avatar: "seed://gf", owner: "user1.bitopiaworld.eth" },
      { walletClient, publicClient, parent: "bitopiaworld.eth" } as any
    );

    expect(writes[0]).toBe("setSubnodeRecord");
    expect(writes).toContain("setAddr");
    expect(writes.filter((w) => w === "setText")).toHaveLength(2);
    expect(result.name).toBe("goldenflower.bitopiaworld.eth");
    expect(result.node).toBe(namehash("goldenflower.bitopiaworld.eth"));
    expect(result.txHash).toMatch(/^0x/);
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

Run: `npx vitest run src/chain/ens.test.ts`
Expected: FAIL — cannot find `./ens`.

- [ ] **Step 3: Implement `server/src/chain/ens.ts`.**

```ts
import type { PublicClient, WalletClient, Hex } from "viem";
import { nameWrapperAbi, resolverAbi } from "./abi.js";
import { namehash, fullName } from "./ensName.js";
import { config } from "../config.js";
import { ensOwnerClient, publicClient as defaultPublic } from "./clients.js";

// VERIFY on Sepolia day one (Task 0). Well-known ENS Sepolia deployments:
export const SEPOLIA_NAME_WRAPPER = "0x0635513f179D50A207757E05759CbD106d7dFcE8" as const;
export const SEPOLIA_PUBLIC_RESOLVER = "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD" as const;

export interface SubnameRecords {
  avatar?: string;
  owner?: string;
  description?: string;
}

// Pure: turn a records object into ordered [key,value] pairs, dropping undefined.
export function buildTextRecords(records: SubnameRecords): [string, string][] {
  const order: (keyof SubnameRecords)[] = ["avatar", "owner", "description"];
  const out: [string, string][] = [];
  for (const k of order) {
    const v = records[k];
    if (v !== undefined) out.push([k, v]);
  }
  return out;
}

export interface EnsDeps {
  walletClient: Pick<WalletClient, "writeContract">;
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">;
  parent: string;
  nameWrapper?: Hex;
  resolver?: Hex;
}

export interface SubnameResult {
  name: string;
  node: Hex;
  txHash: string;
}

export async function ensureSubname(
  label: string,
  owner: `0x${string}`,
  records: SubnameRecords,
  deps: EnsDeps
): Promise<SubnameResult> {
  const nameWrapper = deps.nameWrapper ?? SEPOLIA_NAME_WRAPPER;
  const resolver = deps.resolver ?? SEPOLIA_PUBLIC_RESOLVER;
  const name = fullName(label, deps.parent);
  const parentNode = namehash(deps.parent);
  const node = namehash(name);

  // 1. Issue the wrapped subname, owner = recipient, resolver = public resolver.
  const txHash = await deps.walletClient.writeContract({
    address: nameWrapper,
    abi: nameWrapperAbi,
    functionName: "setSubnodeRecord",
    args: [parentNode, label.toLowerCase(), owner, resolver, 0n, 0, 0n],
  } as any);
  await deps.publicClient.waitForTransactionReceipt({ hash: txHash as Hex });

  // 2. Point the name at the recipient address.
  await deps.walletClient.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "setAddr",
    args: [node, owner],
  } as any);

  // 3. Set each text record.
  for (const [key, value] of buildTextRecords(records)) {
    await deps.walletClient.writeContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "setText",
      args: [node, key, value],
    } as any);
  }

  return { name, node, txHash };
}

// Convenience used by auth/chain register fns with the real clients from config.
export function defaultEnsDeps(): EnsDeps {
  if (!ensOwnerClient) throw new Error("ENS owner wallet not configured (set ENS_PARENT_OWNER_KEY or DEPLOYER_PRIVATE_KEY)");
  return {
    walletClient: ensOwnerClient,
    publicClient: defaultPublic,
    parent: config.ensParentName,
  };
}
```

- [ ] **Step 4: Run; expect PASS.**

Run: `npx vitest run src/chain/ens.test.ts`
Expected: PASS (4 cases — note `setSubnodeRecord` is the first write, `setAddr` present, 2 `setText` for avatar+owner).

- [ ] **Step 5: Commit.**

```bash
git add server/src/chain/ens.ts server/src/chain/ens.test.ts
git commit -m "feat(chain): ensureSubname via NameWrapper + resolver (tested)"
```

---

### Task 8: `chain/wallets.ts` — `agentWalletOps` via Privy server SDK

Implements the frozen `AgentWalletOps` interface and assigns the exported `agentWalletOps` singleton. Backs `createAgentWallet` (Privy server wallet), `sendErc20` (signs a BTPA transfer from the agent wallet — consumed by S4), and `fundEth` (drip gas to the agent wallet). The Privy SDK call shapes are isolated in thin wrappers so day-one version drift only touches this file.

**Files:**
- Create: `server/src/chain/wallets.ts`, `server/src/chain/wallets.test.ts`

- [ ] **Step 1: Failing test `server/src/chain/wallets.test.ts`** (test the pure encode + the injectable factory; not the live Privy SDK).

```ts
import { describe, it, expect, vi } from "vitest";
import { encodeErc20Transfer, makeAgentWalletOps } from "./wallets";

describe("encodeErc20Transfer", () => {
  it("encodes a transfer(to,amount) call", () => {
    const data = encodeErc20Transfer("0x1111111111111111111111111111111111111111", 5_000_000_000_000_000_000n);
    // selector for transfer(address,uint256)
    expect(data.startsWith("0xa9059cbb")).toBe(true);
    expect(data.length).toBe(2 + 8 + 64 + 64); // 0x + selector + 2 args
  });
});

describe("makeAgentWalletOps", () => {
  const token = "0x2222222222222222222222222222222222222222" as const;
  const to = "0x3333333333333333333333333333333333333333" as const;

  it("createAgentWallet returns id + address", async () => {
    const privy = {
      createWallet: vi.fn().mockResolvedValue({ id: "w1", address: "0xWALLET" }),
      sendTransaction: vi.fn(),
    };
    const ops = makeAgentWalletOps({ privy: privy as any, fundEth: vi.fn() });
    const w = await ops.createAgentWallet();
    expect(w).toEqual({ walletId: "w1", address: "0xWALLET" });
    expect(privy.createWallet).toHaveBeenCalled();
  });

  it("sendErc20 sends an encoded transfer from the agent wallet", async () => {
    const privy = {
      createWallet: vi.fn(),
      sendTransaction: vi.fn().mockResolvedValue({ hash: "0xtip" }),
    };
    const ops = makeAgentWalletOps({ privy: privy as any, fundEth: vi.fn() });
    const hash = await ops.sendErc20("w1", token, to, 1_000_000_000_000_000_000n);
    expect(hash).toBe("0xtip");
    expect(privy.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "w1", to: token })
    );
  });

  it("fundEth delegates to injected drip", async () => {
    const fundEth = vi.fn().mockResolvedValue(undefined);
    const ops = makeAgentWalletOps({ privy: {} as any, fundEth });
    await ops.fundEth("0xAGENT");
    expect(fundEth).toHaveBeenCalledWith("0xAGENT");
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

Run: `npx vitest run src/chain/wallets.test.ts`
Expected: FAIL — cannot find `./wallets`.

- [ ] **Step 3: Implement `server/src/chain/wallets.ts`.**

```ts
import { encodeFunctionData, type Hex } from "viem";
import type { AgentWalletOps } from "./walletsTypes.js";
import { erc20Abi } from "./abi.js";
import { dripGas } from "./gas.js";
import { publicClient, treasuryClient } from "./clients.js";

export type { AgentWalletOps };

// Pure: ABI-encode an ERC-20 transfer(to, amount).
export function encodeErc20Transfer(to: `0x${string}`, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
}

// Thin Privy server-wallet surface (adapt method names on day one if the SDK differs).
export interface PrivyServerWallets {
  createWallet(args?: { chainType?: string }): Promise<{ id: string; address: string }>;
  sendTransaction(args: { walletId: string; to: `0x${string}`; data: Hex; chainId: number }): Promise<{ hash: string }>;
}

export interface AgentWalletDeps {
  privy: PrivyServerWallets;
  fundEth: (address: `0x${string}`) => Promise<void>;
}

const SEPOLIA_CHAIN_ID = 11155111;

export function makeAgentWalletOps(deps: AgentWalletDeps): AgentWalletOps {
  return {
    async createAgentWallet() {
      const w = await deps.privy.createWallet({ chainType: "ethereum" });
      return { walletId: w.id, address: w.address as `0x${string}` };
    },
    async sendErc20(walletId, token, to, amount) {
      const data = encodeErc20Transfer(to, amount);
      const res = await deps.privy.sendTransaction({ walletId, to: token, data, chainId: SEPOLIA_CHAIN_ID });
      return res.hash;
    },
    async fundEth(address) {
      await deps.fundEth(address);
    },
  };
}

// Real drip used in production: treasury → agent wallet.
export async function realFundEth(address: `0x${string}`): Promise<void> {
  if (!treasuryClient) throw new Error("treasury wallet not configured (DEPLOYER_PRIVATE_KEY)");
  await dripGas(address, { publicClient, walletClient: treasuryClient });
}
```

- [ ] **Step 4: Create the singleton holder `server/src/chain/walletsTypes.ts`** (re-exports the frozen interface + the `export let` singleton, kept in a tiny file so both `wallets.ts` and `index.ts` import it without a cycle).

```ts
// Mirrors the frozen AgentWalletOps seam from the overview (chain/wallets.ts contract).
export interface AgentWalletOps {
  createAgentWallet(): Promise<{ walletId: string; address: `0x${string}` }>;
  sendErc20(walletId: string, token: `0x${string}`, to: `0x${string}`, amount: bigint): Promise<string>;
  fundEth(address: `0x${string}`): Promise<void>;
}

// Assigned during registerChain(io, app, db). Consumers (S4) import this binding.
export let agentWalletOps: AgentWalletOps;
export function setAgentWalletOps(ops: AgentWalletOps): void {
  agentWalletOps = ops;
}
```

> **Seam note:** the overview declares `export let agentWalletOps` in `server/src/chain/wallets.ts`. S4 imports it from `chain/wallets.js`. So re-export it there:

Add to the bottom of `server/src/chain/wallets.ts`:

```ts
export { agentWalletOps, setAgentWalletOps } from "./walletsTypes.js";
```

- [ ] **Step 5: Run; expect PASS.**

Run: `npx vitest run src/chain/wallets.test.ts`
Expected: PASS (4 cases; selector `0xa9059cbb` confirms correct encoding).

- [ ] **Step 6: Commit.**

```bash
git add server/src/chain/wallets.ts server/src/chain/walletsTypes.ts server/src/chain/wallets.test.ts
git commit -m "feat(chain): agentWalletOps via privy server wallets (tested)"
```

---

### Task 9: `chain/index.ts` — `registerChain` + create-agent endpoints

Assigns the `agentWalletOps` singleton from the real Privy client, wires the create-agent HTTP flow (`/api/agents/prepare`, `/api/agents/confirm`), and emits `tx` socket events for backend-performed txs.

**Files:**
- Create: `server/src/chain/privyServer.ts`, `server/src/chain/index.ts`, `server/src/chain/index.test.ts`
- Modify (one import + one call): `server/src/index.ts`

- [ ] **Step 1: Create the real Privy client wrapper `server/src/chain/privyServer.ts`** (thin; isolated for day-one drift).

```ts
import { PrivyClient } from "@privy-io/server-auth";
import { config } from "../config.js";
import type { PrivyServerWallets } from "./wallets.js";
import type { Hex } from "viem";

export const privy = new PrivyClient(config.privyAppId, config.privyAppSecret);

// Verify a handshake token from the client; returns the privy user id.
export async function verifyPrivyToken(token: string): Promise<{ userId: string }> {
  const claims = await privy.verifyAuthToken(token);
  return { userId: claims.userId };
}

// Adapt the wallet API surface to our thin PrivyServerWallets shape.
export const privyServerWallets: PrivyServerWallets = {
  async createWallet() {
    const w = await privy.walletApi.createWallet({ chainType: "ethereum" });
    return { id: w.id, address: w.address };
  },
  async sendTransaction({ walletId, to, data, chainId }) {
    const res = await privy.walletApi.ethereum.sendTransaction({
      walletId,
      caip2: `eip155:${chainId}`,
      transaction: { to, data, chainId },
    });
    return { hash: (res as any).hash ?? (res as any).transactionHash };
  },
};
```

- [ ] **Step 2: Failing test `server/src/chain/index.test.ts`** (test the pure request validators + the confirm handler with injected deps; not the live SDK/HTTP).

```ts
import { describe, it, expect, vi } from "vitest";
import { validatePrepare, validateConfirm } from "./index";

describe("validatePrepare", () => {
  it("requires name/personality/story/behavior", () => {
    expect(validatePrepare({ name: "GF", personality: "p", story: "s", behavior: "b" }).ok).toBe(true);
  });
  it("rejects missing fields", () => {
    expect(validatePrepare({ name: "GF" }).ok).toBe(false);
  });
  it("rejects blank name", () => {
    expect(validatePrepare({ name: "  ", personality: "p", story: "s", behavior: "b" }).ok).toBe(false);
  });
});

describe("validateConfirm", () => {
  it("requires txHash + agentWallet + draftId", () => {
    expect(validateConfirm({ txHash: "0x1", agentWallet: "0x2", draftId: "d" }).ok).toBe(true);
  });
  it("rejects a non-hex txHash", () => {
    expect(validateConfirm({ txHash: "nope", agentWallet: "0x2", draftId: "d" }).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run; expect FAIL.**

Run: `npx vitest run src/chain/index.test.ts`
Expected: FAIL — cannot find `./index`.

- [ ] **Step 4: Implement `server/src/chain/index.ts`.**

```ts
import type { Express, Request, Response } from "express";
import type { Server } from "socket.io";
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { makeAgentWalletOps, realFundEth, setAgentWalletOps } from "./wallets.js";
import { privy, privyServerWallets, verifyPrivyToken } from "./privyServer.js";
import { publicClient } from "./clients.js";
import { ensureSubname, defaultEnsDeps } from "./ens.js";
import { makeTxRecord } from "./tx.js";
import { fullName } from "./ensName.js";
import { config } from "../config.js";
import { bus } from "../bus.js";
import { avatarSeedToColor } from "shared/avatar";

interface PrepareBody { name?: string; personality?: string; story?: string; behavior?: string }
interface ConfirmBody { txHash?: string; agentWallet?: string; draftId?: string }

export function validatePrepare(b: PrepareBody): { ok: boolean } {
  const reqd = [b.name, b.personality, b.story, b.behavior];
  const ok = reqd.every((v) => typeof v === "string" && v.trim().length > 0);
  return { ok };
}

export function validateConfirm(b: ConfirmBody): { ok: boolean } {
  const hexOk = typeof b.txHash === "string" && /^0x[0-9a-fA-F]+$/.test(b.txHash);
  const addrOk = typeof b.agentWallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(b.agentWallet);
  const draftOk = typeof b.draftId === "string" && b.draftId.length > 0;
  return { ok: hexOk && addrOk && draftOk };
}

// In-memory drafts created at /prepare, consumed at /confirm.
interface Draft {
  ownerUserId: string;
  name: string; personality: string; story: string; behavior: string;
  walletId: string; walletAddress: `0x${string}`; roomId: string;
}

async function authUser(req: Request): Promise<string> {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const { userId } = await verifyPrivyToken(token);
  return userId;
}

export function registerChain(io: Server, app: Express, db: Database): void {
  // Assign the frozen singleton with the real Privy + drip wiring.
  setAgentWalletOps(makeAgentWalletOps({ privy: privyServerWallets, fundEth: realFundEth }));
  const ops = makeAgentWalletOps({ privy: privyServerWallets, fundEth: realFundEth });

  const drafts = new Map<string, Draft>();

  // Helper: emit a backend tx to the room feed.
  const emitTx = (rec: ReturnType<typeof makeTxRecord>, roomId?: string) => {
    if (roomId) io.to(roomId).emit("tx", { record: rec });
    else io.emit("tx", { record: rec });
  };

  app.use(require("express").json());

  // POST /api/agents/prepare — create the Privy server wallet, return its address.
  app.post("/api/agents/prepare", async (req: Request, res: Response) => {
    try {
      const userId = await authUser(req);
      const v = validatePrepare(req.body);
      if (!v.ok) return res.status(400).json({ error: "missing fields" });

      const userRow = db.prepare("SELECT room_id FROM users WHERE id = ?").get(userId) as { room_id: string } | undefined;
      if (!userRow) return res.status(404).json({ error: "user not found" });

      const wallet = await ops.createAgentWallet();
      await ops.fundEth(wallet.address); // gas for the agent's autonomous txs

      const draftId = randomUUID();
      drafts.set(draftId, {
        ownerUserId: userId,
        name: req.body.name.trim(),
        personality: req.body.personality,
        story: req.body.story,
        behavior: req.body.behavior,
        walletId: wallet.walletId,
        walletAddress: wallet.address,
        roomId: userRow.room_id,
      });

      res.json({ draftId, agentWallet: wallet.address });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  // POST /api/agents/confirm — verify createAgent tx, register ENS, write row, emit bus.
  app.post("/api/agents/confirm", async (req: Request, res: Response) => {
    try {
      const userId = await authUser(req);
      const v = validateConfirm(req.body);
      if (!v.ok) return res.status(400).json({ error: "invalid confirm" });

      const draft = drafts.get(req.body.draftId);
      if (!draft || draft.ownerUserId !== userId) return res.status(404).json({ error: "draft not found" });

      // Verify the createAgent tx actually mined successfully.
      const receipt = await publicClient.waitForTransactionReceipt({ hash: req.body.txHash as Hex });
      if (receipt.status !== "success") return res.status(400).json({ error: "createAgent tx failed" });

      const agentId = randomUUID();
      const avatarSeed = draft.walletAddress;

      // ENS subname: name.bitopiaworld.eth with avatar + owner text records.
      const ownerName =
        (db.prepare("SELECT ens_name FROM users WHERE id = ?").get(userId) as { ens_name?: string } | undefined)?.ens_name ?? userId;
      const label = draft.name.toLowerCase().replace(/[^a-z0-9-]/g, "");
      const ens = await ensureSubname(
        label,
        draft.walletAddress,
        { avatar: avatarSeedToColor(avatarSeed), owner: ownerName },
        defaultEnsDeps()
      );
      emitTx(makeTxRecord("ensRegister", ens.txHash, `Registered ${ens.name}`), draft.roomId);

      // Persist the agent.
      db.prepare(
        `INSERT INTO agents (id, owner_user_id, name, ens_name, wallet_id, wallet_address, personality, story, behavior, room_id, avatar_seed, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        agentId, userId, draft.name, ens.name, draft.walletId, draft.walletAddress,
        draft.personality, draft.story, draft.behavior, draft.roomId, avatarSeed, Date.now()
      );

      // The createAgent tx itself was client-initiated; echo it to the feed too.
      emitTx(makeTxRecord("createAgent", req.body.txHash, `Created agent ${draft.name}`), draft.roomId);

      drafts.delete(req.body.draftId);
      bus.emitT("agentCreated", { agentId });
      res.json({ agentId, ensName: ens.name });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });
}
```

> Note: `app.use(require("express").json())` — if ESM `require` is unavailable, replace with a top-level `import express from "express"` and `app.use(express.json())`. Keep the body parser scoped so it doesn't conflict with S2 (which doesn't post JSON). At integration, ensure `express.json()` is installed once; if S0/S2 already add it globally, drop this line.

- [ ] **Step 5: Run; expect PASS.**

Run: `npx vitest run src/chain/index.test.ts`
Expected: PASS (validators).

- [ ] **Step 6: Wire into `server/src/index.ts`** — add ONE import + ONE call (uncomment / add the registerChain line at the documented merge point).

```ts
import { registerChain } from "./chain/index.js";
// ...after db is created:
registerChain(io, app, db);
```

- [ ] **Step 7: Typecheck.**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit.**

```bash
git add server/src/chain/privyServer.ts server/src/chain/index.ts server/src/chain/index.test.ts server/src/index.ts
git commit -m "feat(chain): registerChain + create-agent prepare/confirm endpoints (tested)"
```

---

### Task 10: `auth/index.ts` — `registerAuth`: Privy token middleware + getOrCreateUser

Installs `io.use(authMiddleware)`: verifies the handshake Privy token, gets-or-creates the user + their room, drips gas, ensures the user (`userN`, avatar record) and room (`userN-room`, owner record) ENS subnames, then sets `socket.data.user` (SocketUser shape).

**Files:**
- Create: `server/src/auth/userProvision.ts`, `server/src/auth/userProvision.test.ts`, `server/src/auth/index.ts`, `server/src/auth/index.test.ts`
- Modify (one import + one call): `server/src/index.ts`

- [ ] **Step 1: Failing test `server/src/auth/userProvision.test.ts`** (pure: numbering + SocketUser shaping; DB injected via better-sqlite3 in-memory).

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nextUserNumber, toSocketUser, getOrCreateUserRow } from "./userProvision";

const here = dirname(fileURLToPath(import.meta.url));
function freshDb() {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(here, "../db/schema.sql"), "utf8"));
  return db;
}

describe("nextUserNumber", () => {
  it("starts at 1 on an empty db", () => {
    expect(nextUserNumber(freshDb())).toBe(1);
  });
  it("increments with existing users", () => {
    const db = freshDb();
    db.prepare("INSERT INTO users (id,address,avatar_seed,room_id,created_at) VALUES (?,?,?,?,?)")
      .run("u1", "0xa", "0xa", "r1", Date.now());
    expect(nextUserNumber(db)).toBe(2);
  });
});

describe("getOrCreateUserRow", () => {
  it("creates a user + room on first call and is idempotent", () => {
    const db = freshDb();
    const a = getOrCreateUserRow(db, "privy1", "0xabc");
    expect(a.created).toBe(true);
    expect(a.userNumber).toBe(1);
    const roomCount = (db.prepare("SELECT COUNT(*) c FROM rooms").get() as any).c;
    expect(roomCount).toBe(1);

    const b = getOrCreateUserRow(db, "privy1", "0xabc");
    expect(b.created).toBe(false);
    expect(b.row.id).toBe("privy1");
  });
});

describe("toSocketUser", () => {
  it("maps a user row to the SocketUser shape", () => {
    const su = toSocketUser({
      id: "privy1", address: "0xabc", ens_name: "user1.bitopiaworld.eth",
      avatar_seed: "0xabc", room_id: "r1",
    } as any);
    expect(su).toEqual({
      id: "privy1", address: "0xabc", ensName: "user1.bitopiaworld.eth",
      avatarSeed: "0xabc", roomId: "r1",
    });
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

Run: `npx vitest run src/auth/userProvision.test.ts`
Expected: FAIL — cannot find `./userProvision`.

- [ ] **Step 3: Implement `server/src/auth/userProvision.ts`.**

```ts
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SocketUser } from "shared/types";

export interface UserRow {
  id: string; address: string; ens_name?: string; avatar_seed: string; room_id: string;
}

export function nextUserNumber(db: Database): number {
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return c + 1;
}

export interface ProvisionResult {
  row: UserRow;
  created: boolean;
  userNumber: number; // only meaningful when created
}

// Creates the users + rooms rows on first sight; idempotent thereafter.
export function getOrCreateUserRow(db: Database, privyUserId: string, address: string): ProvisionResult {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(privyUserId) as UserRow | undefined;
  if (existing) return { row: existing, created: false, userNumber: -1 };

  const userNumber = nextUserNumber(db);
  const roomId = randomUUID();
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO rooms (id, owner_user_id, width, height, created_at) VALUES (?,?,?,?,?)"
    ).run(roomId, privyUserId, 30, 30, now);
    db.prepare(
      "INSERT INTO users (id, address, avatar_seed, room_id, created_at) VALUES (?,?,?,?,?)"
    ).run(privyUserId, address, address, roomId, now);
  });
  tx();

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(privyUserId) as UserRow;
  return { row, created: true, userNumber };
}

export function toSocketUser(row: UserRow): SocketUser {
  return {
    id: row.id,
    address: row.address,
    ensName: row.ens_name ?? undefined,
    avatarSeed: row.avatar_seed,
    roomId: row.room_id,
  };
}
```

- [ ] **Step 4: Run; expect PASS.**

Run: `npx vitest run src/auth/userProvision.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Implement `server/src/auth/index.ts`** (the middleware; the verify + onchain side-effects are wrapped so they can be injected/skipped in dev).

```ts
import type { Express } from "express";
import type { Server, Socket } from "socket.io";
import type { Database } from "better-sqlite3";
import type { SocketUser } from "shared/types";
import { getOrCreateUserRow, toSocketUser, type ProvisionResult } from "./userProvision.js";
import { verifyPrivyToken, privy } from "../chain/privyServer.js";
import { publicClient, treasuryClient, ensOwnerClient } from "../chain/clients.js";
import { dripGas } from "../chain/gas.js";
import { ensureSubname, defaultEnsDeps } from "../chain/ens.js";
import { userLabel, roomLabel } from "../chain/ensName.js";
import { makeTxRecord } from "../chain/tx.js";
import { avatarSeedToColor } from "shared/avatar";

// Resolve the embedded wallet address from the Privy user's linked accounts.
async function addressForUser(privyUserId: string): Promise<`0x${string}`> {
  const user = await privy.getUser(privyUserId);
  const wallet = (user.linkedAccounts ?? []).find((a: any) => a.type === "wallet");
  const addr = (wallet as any)?.address;
  if (!addr) throw new Error("no embedded wallet on privy user");
  return addr as `0x${string}`;
}

// Run gas drip + user/room ENS subnames for a freshly-created user. Best-effort:
// failures are logged but do not block login (so the demo still spawns).
async function provisionOnchain(io: Server, db: Database, p: ProvisionResult, address: `0x${string}`): Promise<void> {
  try {
    if (treasuryClient) {
      await dripGas(address, { publicClient, walletClient: treasuryClient });
    }
    if (ensOwnerClient) {
      const uLabel = userLabel(p.userNumber);
      const rLabel = roomLabel(p.userNumber);
      const userEns = await ensureSubname(uLabel, address, { avatar: avatarSeedToColor(address) }, defaultEnsDeps());
      const roomEns = await ensureSubname(rLabel, address, { owner: userEns.name }, defaultEnsDeps());

      db.prepare("UPDATE users SET ens_name = ? WHERE id = ?").run(userEns.name, p.row.id);
      db.prepare("UPDATE rooms SET ens_name = ? WHERE id = ?").run(roomEns.name, p.row.room_id);

      io.to(p.row.room_id).emit("tx", { record: makeTxRecord("ensRegister", userEns.txHash, `Registered ${userEns.name}`) });
      io.to(p.row.room_id).emit("tx", { record: makeTxRecord("ensRegister", roomEns.txHash, `Registered ${roomEns.name}`) });
    }
  } catch (e) {
    console.error("[auth] onchain provisioning failed (non-fatal):", e);
  }
}

export function registerAuth(io: Server, _app: Express, db: Database): void {
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.privyToken as string | undefined;
      if (!token) return next(new Error("missing privy token"));

      const { userId } = await verifyPrivyToken(token);
      const address = await addressForUser(userId);

      const p = getOrCreateUserRow(db, userId, address);
      if (p.created) {
        await provisionOnchain(io, db, p, address);
      }

      const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      const su: SocketUser = toSocketUser(fresh);
      socket.data.user = su;
      next();
    } catch (e: any) {
      next(new Error(`auth failed: ${e?.message ?? e}`));
    }
  });
}
```

- [ ] **Step 6: Failing test `server/src/auth/index.test.ts`** (middleware behavior with the verify/address/onchain pieces stubbed — we test that a token produces `socket.data.user` and that a missing token errors). Because the middleware imports SDK modules, test through a small injectable seam: refactor the verify + address fns into params.

Refactor `registerAuth` to accept optional injected deps (keeps prod call one-line):

```ts
export interface AuthDeps {
  verify: (token: string) => Promise<{ userId: string }>;
  address: (userId: string) => Promise<`0x${string}`>;
  provision: (p: ProvisionResult, address: `0x${string}`) => Promise<void>;
}

export function registerAuthWith(io: Server, db: Database, deps: AuthDeps): void {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.privyToken as string | undefined;
      if (!token) return next(new Error("missing privy token"));
      const { userId } = await deps.verify(token);
      const address = await deps.address(userId);
      const p = getOrCreateUserRow(db, userId, address);
      if (p.created) await deps.provision(p, address);
      const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      socket.data.user = toSocketUser(fresh);
      next();
    } catch (e: any) {
      next(new Error(`auth failed: ${e?.message ?? e}`));
    }
  });
}
```

And make `registerAuth` delegate to it with the real deps:

```ts
export function registerAuth(io: Server, _app: Express, db: Database): void {
  registerAuthWith(io, db, {
    verify: verifyPrivyToken,
    address: addressForUser,
    provision: (p, address) => provisionOnchain(io, db, p, address),
  });
}
```

Test:

```ts
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAuthWith } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
function freshDb() {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(here, "../db/schema.sql"), "utf8"));
  return db;
}

// Minimal fake io that captures the middleware and lets us invoke it.
function fakeIo() {
  let mw: any;
  return { use: (fn: any) => { mw = fn; }, run: (socket: any) => new Promise<Error | undefined>((r) => mw(socket, r)) };
}

describe("registerAuthWith", () => {
  it("sets socket.data.user for a valid token (and provisions new users)", async () => {
    const db = freshDb();
    const io = fakeIo();
    const provision = vi.fn().mockResolvedValue(undefined);
    registerAuthWith(io as any, db, {
      verify: async () => ({ userId: "privy1" }),
      address: async () => "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
      provision,
    });
    const socket: any = { handshake: { auth: { privyToken: "t" } }, data: {} };
    const err = await io.run(socket);
    expect(err).toBeUndefined();
    expect(socket.data.user.id).toBe("privy1");
    expect(socket.data.user.roomId).toBeTruthy();
    expect(provision).toHaveBeenCalledTimes(1);
  });

  it("errors when token missing", async () => {
    const db = freshDb();
    const io = fakeIo();
    registerAuthWith(io as any, db, {
      verify: async () => ({ userId: "x" }),
      address: async () => "0x0000000000000000000000000000000000000000",
      provision: vi.fn(),
    });
    const err = await io.run({ handshake: { auth: {} }, data: {} } as any);
    expect(err).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 7: Run; expect FAIL then PASS.**

Run: `npx vitest run src/auth/index.test.ts`
Expected: FAIL until `registerAuthWith` exists, then PASS (2 cases).

- [ ] **Step 8: Wire into `server/src/index.ts`** — one import + one call. **Order matters:** `registerAuth` installs `io.use` so `socket.data.user` is set before S2's `connection` handler runs; call it before `registerWorld`.

```ts
import { registerAuth } from "./auth/index.js";
// ...
registerAuth(io, app, db);   // before registerWorld so socket.data.user is ready
```

- [ ] **Step 9: Typecheck + full server test run.**

Run: `npx tsc -p server/tsconfig.json --noEmit && npx vitest run` (from `server/`)
Expected: typecheck clean; all server tests PASS.

- [ ] **Step 10: Commit.**

```bash
git add server/src/auth server/src/index.ts
git commit -m "feat(auth): privy token middleware + user/room provisioning + ENS/gas (tested)"
```

---

### Task 11: Client `wallet/` — Privy provider, `useChain`, WalletPanel (Blink + convert), TxFeed

**Files:**
- Create: `client/src/wallet/PrivyProvider.tsx`, `client/src/wallet/txStore.ts`, `client/src/wallet/txStore.test.ts`, `client/src/wallet/useChain.ts`, `client/src/wallet/WalletPanel.tsx`, `client/src/wallet/TxFeed.tsx`, `client/src/wallet/abi.ts`, `client/src/wallet/deployments.ts`
- Modify: `client/package.json` (Blink SDK — name confirmed day one)

- [ ] **Step 1: Client ABIs + deployments loader.** Create `client/src/wallet/abi.ts` (copy the `erc20Abi` + `bitopiaCoreAbi` fragments from `server/src/chain/abi.ts` — same frozen interface) and `client/src/wallet/deployments.ts`:

```ts
// At integration, S1 publishes contracts/deployments/sepolia.json; Vite serves it
// from a copy under client public or via import. For now import it directly.
import raw from "../../../contracts/deployments/sepolia.json";

export interface Deployments {
  chainId: number; BTPA: `0x${string}`; BitopiaCore: `0x${string}`; USDC: `0x${string}`;
}
export const deployments = raw as Deployments;
```

`client/src/wallet/abi.ts`:

```ts
export const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const bitopiaCoreAbi = [
  { type: "function", name: "convert", stateMutability: "nonpayable",
    inputs: [{ name: "usdcAmount", type: "uint256" }], outputs: [] },
  { type: "function", name: "createAgent", stateMutability: "nonpayable",
    inputs: [{ name: "agentWallet", type: "address" }], outputs: [] },
] as const;
```

- [ ] **Step 2: TDD the tx store `client/src/wallet/txStore.test.ts`** (pure dedup + ordering for the feed).

```ts
import { describe, it, expect } from "vitest";
import { addTx, type TxState } from "./txStore";
import { makeTxRecord } from "./tx";

describe("addTx", () => {
  it("prepends newest first", () => {
    let s: TxState = [];
    s = addTx(s, makeTxRecord("convert", "0x1", "a", 1));
    s = addTx(s, makeTxRecord("tip", "0x2", "b", 2));
    expect(s.map((r) => r.hash)).toEqual(["0x2", "0x1"]);
  });
  it("dedupes by hash", () => {
    let s: TxState = [];
    const r = makeTxRecord("convert", "0x1", "a", 1);
    s = addTx(s, r);
    s = addTx(s, r);
    expect(s).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run; expect FAIL.**

Run: `npx vitest run src/wallet/txStore.test.ts`
Expected: FAIL — cannot find `./txStore`.

- [ ] **Step 4: Implement `client/src/wallet/txStore.ts`.**

```ts
import type { TxRecord } from "shared/types";

export type TxState = TxRecord[];

export function addTx(state: TxState, rec: TxRecord): TxState {
  if (state.some((r) => r.hash === rec.hash)) return state;
  return [rec, ...state];
}
```

- [ ] **Step 5: Run; expect PASS.**

Run: `npx vitest run src/wallet/txStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `client/src/wallet/PrivyProvider.tsx`** (embedded wallets, email/social login).

```tsx
import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export function AppPrivyProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        appearance: { theme: "dark" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

- [ ] **Step 7: Implement `client/src/wallet/useChain.ts`** (viem walletClient from the Privy embedded wallet; `approve`, `convert`, `createAgent`; each returns a hash + pushes a TxRecord).

```ts
import { useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, createPublicClient, custom, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { erc20Abi, bitopiaCoreAbi } from "./abi";
import { deployments } from "./deployments";
import { makeTxRecord } from "./tx";
import type { TxRecord } from "shared/types";

export function useChain(onTx: (rec: TxRecord) => void) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();

  const getClients = useCallback(async () => {
    const wallet = wallets[0];
    if (!wallet) throw new Error("no wallet");
    await wallet.switchChain(sepolia.id);
    const provider = await wallet.getEthereumProvider();
    const account = wallet.address as Hex;
    const walletClient = createWalletClient({ account, chain: sepolia, transport: custom(provider) });
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(import.meta.env.VITE_SEPOLIA_RPC_URL),
    });
    return { walletClient, publicClient, account };
  }, [wallets]);

  const approve = useCallback(async (amount: bigint) => {
    const { walletClient, account } = await getClients();
    const hash = await walletClient.writeContract({
      address: deployments.USDC, abi: erc20Abi, functionName: "approve",
      args: [deployments.BitopiaCore, amount], account,
    });
    onTx(makeTxRecord("convert", hash, `Approved ${amount} USDC`));
    return hash;
  }, [getClients, onTx]);

  const convert = useCallback(async (usdc6: bigint) => {
    await approve(usdc6);
    const { walletClient, publicClient, account } = await getClients();
    const hash = await walletClient.writeContract({
      address: deployments.BitopiaCore, abi: bitopiaCoreAbi, functionName: "convert",
      args: [usdc6], account,
    });
    onTx(makeTxRecord("convert", hash, `Converted USDC → $BTPA`));
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }, [approve, getClients, onTx]);

  const createAgent = useCallback(async (agentWallet: Hex) => {
    const { walletClient, publicClient, account } = await getClients();
    const hash = await walletClient.writeContract({
      address: deployments.BitopiaCore, abi: bitopiaCoreAbi, functionName: "createAgent",
      args: [agentWallet], account,
    });
    onTx(makeTxRecord("createAgent", hash, `Create-agent burn + fund`));
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }, [getClients, onTx]);

  return { authenticated, approve, convert, createAgent, getClients };
}
```

- [ ] **Step 8: Implement `client/src/wallet/WalletPanel.tsx`** (address + ENS name + USDC/BTPA balances, Blink deposit widget with documented fallback, Convert button).

```tsx
import { useEffect, useState, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { erc20Abi } from "./abi";
import { deployments } from "./deployments";
import { useChain } from "./useChain";
import { parseUsdc, formatUnitsFixed, usdcToBtpa } from "./units";
import { makeTxRecord } from "./tx";
import type { TxRecord } from "shared/types";

const pub = () => createPublicClient({ chain: sepolia, transport: http(import.meta.env.VITE_SEPOLIA_RPC_URL) });

export function WalletPanel({ onTx, ensName }: { onTx: (r: TxRecord) => void; ensName?: string }) {
  const { authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { convert } = useChain(onTx);
  const [usdc, setUsdc] = useState(0n);
  const [btpa, setBtpa] = useState(0n);
  const [amount, setAmount] = useState("10");
  const address = wallets[0]?.address as Hex | undefined;

  const refresh = useCallback(async () => {
    if (!address) return;
    const c = pub();
    const [u, b] = await Promise.all([
      c.readContract({ address: deployments.USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      c.readContract({ address: deployments.BTPA, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    ]);
    setUsdc(u as bigint); setBtpa(b as bigint);
  }, [address]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!authenticated) {
    return <div style={panel}><button onClick={login}>Log in with Privy</button></div>;
  }

  return (
    <div style={panel}>
      <div style={{ fontWeight: 600 }}>{ensName ?? `${address?.slice(0, 6)}…${address?.slice(-4)}`}</div>
      <div>USDC: {formatUnitsFixed(usdc, 6, 2)}</div>
      <div>$BTPA: {formatUnitsFixed(btpa, 18, 2)}</div>

      {/* BLINK DEPOSIT WIDGET — primary on-ramp. See day-one note: confirm SDK + token.
          Fallback (MockUSDC faucet) below keeps the loop unblocked. */}
      <BlinkDeposit onDeposited={refresh} onTx={onTx} address={address} />

      <div style={{ marginTop: 8 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 60 }} /> USDC
        <button
          onClick={async () => { await convert(parseUsdc(amount)); await refresh(); }}
          disabled={parseUsdc(amount) === 0n}
        >
          Convert → {formatUnitsFixed(usdcToBtpa(parseUsdc(amount)), 18, 2)} $BTPA
        </button>
      </div>
      <button onClick={logout} style={{ marginTop: 8 }}>Log out</button>
    </div>
  );
}

// Blink deposit. If Blink testnet isn't ready, the fallback faucet mints MockUSDC
// so convert→create→tip is never blocked (documented day-one risk).
function BlinkDeposit({ onDeposited, onTx, address }:
  { onDeposited: () => void; onTx: (r: TxRecord) => void; address?: Hex }) {
  const { getClients } = useChain(onTx);

  const blinkDeposit = async () => {
    // TODO(day-one): replace with the confirmed Blink SDK deposit action.
    // Blink renders/handles the action; on success it lands testnet USDC in `address`.
    // Until confirmed, fall through to the faucet fallback below.
    return faucetFallback();
  };

  const faucetFallback = async () => {
    if (!address) return;
    const { walletClient } = await getClients();
    const hash = await walletClient.writeContract({
      address: deployments.USDC,
      abi: [{ type: "function", name: "mint", stateMutability: "nonpayable",
        inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }],
      functionName: "mint",
      args: [address, 10_000_000n], // 10 USDC (6dp) — MockUSDC faucet
    });
    onTx(makeTxRecord("deposit", hash, "Faucet: minted 10 test USDC"));
    onDeposited();
  };

  return <button onClick={blinkDeposit} style={{ marginTop: 8 }}>Deposit 10 USDC (Blink)</button>;
}

const panel: React.CSSProperties = {
  position: "absolute", top: 12, right: 12, width: 240, padding: 12,
  background: "#1a2230", color: "#cfe", borderRadius: 8, fontSize: 13, zIndex: 10,
};
```

> **Blink integration (day one):** once the Blink SDK + testnet token are confirmed, replace `blinkDeposit`'s body with the real Blink action (e.g. render the Blink "blink" component / call its deposit action targeting `address`). Keep `faucetFallback` as the documented backup wired to MockUSDC's `mint`. Add the Blink SDK to `client/package.json` at that point.

- [ ] **Step 9: Implement `client/src/wallet/TxFeed.tsx`** (renders TxRecords with Etherscan links; consumes local txs + `tx` socket events).

```tsx
import type { TxRecord } from "shared/types";

export function TxFeed({ records }: { records: TxRecord[] }) {
  return (
    <div style={feed}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Onchain activity</div>
      {records.length === 0 && <div style={{ opacity: 0.6 }}>No transactions yet</div>}
      {records.map((r) => (
        <div key={r.hash} style={{ marginBottom: 6 }}>
          <div>{r.label}</div>
          <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#7cf" }}>
            {r.hash.slice(0, 10)}… ↗
          </a>
        </div>
      ))}
    </div>
  );
}

const feed: React.CSSProperties = {
  position: "absolute", bottom: 12, right: 12, width: 240, maxHeight: 240, overflowY: "auto",
  padding: 12, background: "#1a2230", color: "#cfe", borderRadius: 8, fontSize: 12, zIndex: 10,
};
```

- [ ] **Step 10: Run client tests.**

Run: `npx vitest run` (from `client/`)
Expected: PASS (`units`, `tx`, `txStore`).

- [ ] **Step 11: Commit.**

```bash
git add client/src/wallet
git commit -m "feat(wallet): privy provider, useChain, wallet panel (blink+convert), tx feed (tested)"
```

---

### Task 12: Client `ui/CreateAgentForm.tsx` + App wiring + socket token

**Files:**
- Create: `client/src/ui/CreateAgentForm.tsx`
- Modify: `client/src/App.tsx` (mount panels, wrap in Privy, wire socket token)

- [ ] **Step 1: Implement `client/src/ui/CreateAgentForm.tsx`** (prepare → onchain createAgent → confirm; pushes txs to the feed).

```tsx
import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useChain } from "../wallet/useChain";
import type { TxRecord } from "shared/types";
import type { Hex } from "viem";

const API = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:8787";

export function CreateAgentForm({ onTx }: { onTx: (r: TxRecord) => void }) {
  const { getAccessToken, authenticated } = usePrivy();
  const { createAgent } = useChain(onTx);
  const [f, setF] = useState({ name: "Golden Flower", personality: "Friendly", story: "", behavior: "" });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  if (!authenticated) return null;

  const submit = async () => {
    setBusy(true);
    try {
      const token = await getAccessToken();
      const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      setStatus("Creating agent wallet…");
      const prep = await fetch(`${API}/api/agents/prepare`, {
        method: "POST", headers: auth, body: JSON.stringify(f),
      }).then((r) => r.json());
      if (prep.error) throw new Error(prep.error);

      setStatus("Burning $BTPA on-chain…");
      const txHash = await createAgent(prep.agentWallet as Hex);

      setStatus("Registering ENS + finishing…");
      const conf = await fetch(`${API}/api/agents/confirm`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ txHash, agentWallet: prep.agentWallet, draftId: prep.draftId }),
      }).then((r) => r.json());
      if (conf.error) throw new Error(conf.error);

      setStatus(`Created ${conf.ensName}`);
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof typeof f, label: string, area = false) => (
    <label style={{ display: "block", marginBottom: 6 }}>
      {label}
      {area
        ? <textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ width: "100%" }} />
        : <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ width: "100%" }} />}
    </label>
  );

  return (
    <div style={box}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Create Agent</div>
      {field("name", "Name")}
      {field("personality", "Personality")}
      {field("story", "Story", true)}
      {field("behavior", "Behavior rule", true)}
      <button onClick={submit} disabled={busy}>{busy ? "Working…" : "Create"}</button>
      {status && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{status}</div>}
    </div>
  );
}

const box: React.CSSProperties = {
  position: "absolute", top: 12, left: 12, width: 260, padding: 12,
  background: "#1a2230", color: "#cfe", borderRadius: 8, fontSize: 13, zIndex: 10,
};
```

- [ ] **Step 2: Wire `client/src/App.tsx`** — wrap in `<AppPrivyProvider>`, mount `<WalletPanel/>`, `<CreateAgentForm/>`, `<TxFeed/>`, hold tx state (local + socket `tx` events), and connect the socket with the Privy access token. Keep S2's mount points intact (only add S3 lines).

```tsx
import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AppPrivyProvider } from "./wallet/PrivyProvider";
import { WalletPanel } from "./wallet/WalletPanel";
import { TxFeed } from "./wallet/TxFeed";
import { CreateAgentForm } from "./ui/CreateAgentForm";
import { addTx, type TxState } from "./wallet/txStore";
import { connectSocket, type AppSocket } from "./net/socket";
import type { TxRecord } from "shared/types";

function Shell() {
  const { authenticated, getAccessToken } = usePrivy();
  const [txs, setTxs] = useState<TxState>([]);
  const pushTx = useMemo(() => (r: TxRecord) => setTxs((s) => addTx(s, r)), []);

  // Connect socket with the Privy token once authenticated; relay tx events to the feed.
  useEffect(() => {
    if (!authenticated) return;
    let socket: AppSocket | undefined;
    let cancelled = false;
    (async () => {
      const token = (await getAccessToken()) ?? undefined;
      if (cancelled) return;
      socket = connectSocket(token);
      socket.on("tx", ({ record }) => pushTx(record));
      // S2 mounts its render/chat handlers on the same socket via its own setup.
    })();
    return () => { cancelled = true; socket?.disconnect(); };
  }, [authenticated, getAccessToken, pushTx]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* <RenderCanvas/>  S2 */}
      {/* <ChatBox/>       S2 */}
      <WalletPanel onTx={pushTx} />
      <CreateAgentForm onTx={pushTx} />
      <TxFeed records={txs} />
    </div>
  );
}

export default function App() {
  return (
    <AppPrivyProvider>
      <Shell />
    </AppPrivyProvider>
  );
}
```

> **Integration note (socket ownership):** S2 also creates a socket. At S6 integration, consolidate to ONE shared socket instance (lift `connectSocket(token)` to a context both S2 and S3 read), so there's a single connection carrying the Privy token. For this stream, the above is self-contained and testable; flag the consolidation in the S6 merge.

- [ ] **Step 3: Verify the client builds/typechecks.**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: no errors (a missing `contracts/deployments/sepolia.json` import will error until S1 publishes it; if so, create a temporary `contracts/deployments/sepolia.json` with placeholder `0x…` addresses to typecheck locally, and DO NOT commit it — it's S1-owned).

- [ ] **Step 4: Manual smoke (optional, needs real keys).** With `.env` filled, `npm run dev:client` + `npm run dev:server`: log in with Privy → see address/ENS/balances → faucet mint → convert → create agent → watch the TxFeed populate with Etherscan links.

- [ ] **Step 5: Commit.**

```bash
git add client/src/ui/CreateAgentForm.tsx client/src/App.tsx
git commit -m "feat(ui): create-agent form + app wiring + privy-token socket connect"
```

---

### Final verification

- [ ] **Step 1: Run all stream tests.**

Run: `npx vitest run` in both `server/` and `client/`
Expected: all PASS — `units`, `ensName`, `tx` (×2), `gas`, `deployments`, `ens`, `wallets`, `chain/index`, `auth/userProvision`, `auth/index`, `txStore`.

- [ ] **Step 2: Typecheck both packages.**

Run: `npx tsc -p server/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit`
Expected: clean (modulo the S1-owned deployments json caveat above).

- [ ] **Step 3: Confirm seam compliance (self-review).**
  - `agentWalletOps` matches the frozen `AgentWalletOps` signature and is assigned in `registerChain`. ✔
  - Auth middleware sets `socket.data.user` as `SocketUser`. ✔
  - `TxRecord`s use the frozen kinds + Etherscan URLs; backend txs emitted via `io.emit("tx", { record })`. ✔
  - `bus.emitT("agentCreated", { agentId })` fires after row write + ENS. ✔
  - Only owned paths + one-line registrations touched. ✔

- [ ] **Step 4: Commit any final fixes; push the branch.**

```bash
git commit -am "chore(s3): final verification pass" || true
git push -u origin s3-identity
```

---

## Self-review notes

- **Prize coverage:**
  - **Privy** — embedded wallets via `AppPrivyProvider` (`createOnLogin`), server wallets via `agentWalletOps.createAgentWallet` + `sendErc20` signing real BTPA transfers (the autonomous-agent thesis; consumed by S4). Token verified server-side in the auth middleware.
  - **ENS** — `ensureSubname` issues NameWrapper subnames for **users** (`userN`, avatar record), **rooms** (`userN-room`, owner record), and **agents** (`name`, avatar+owner records) with resolver `setAddr` + `setText`. Names flow into `SocketUser.ensName` / `agents.ens_name` and show in the UI.
  - **Blink** — `BlinkDeposit` widget is the featured on-ramp; documented MockUSDC faucet fallback guarantees the convert→create→tip loop is never blocked if Blink testnet isn't ready.
  - **Show-the-chain** — every onchain action produces a `TxRecord` with a Sepolia Etherscan link; client txs pushed locally, backend txs (ENS, agent tips) emitted over the `tx` socket event into `TxFeed`.
- **TDD coverage:** all pure logic tested — `usdcToBtpa`/`parseUsdc`/`formatUnitsFixed`, `labelhash`/`namehash`/name builders, `etherscanTxUrl`/`makeTxRecord`, `shouldDrip`/`dripGas` (injected clients), `buildTextRecords`/`ensureSubname` (injected client), `encodeErc20Transfer`/`makeAgentWalletOps`, request validators, `getOrCreateUserRow`/`toSocketUser`/`nextUserNumber`, `registerAuthWith`, `addTx`. Network/SDK calls isolated behind injectable wrappers.
- **Day-one risks (front-loaded):** NameWrapper parent must be registered+wrapped and one subname pre-tested; Privy server-wallet API surface confirmed; Blink SDK/token/source-USDC confirmed with the faucet fallback ready.
- **No seam drift:** vendored ABI fragments mirror the frozen contract interfaces; `agentWalletOps` signature is copied verbatim; only one-line registrations added to `index.ts`/`App.tsx`.
