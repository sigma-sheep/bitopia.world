# Wallet View & Funding — Design

**Date:** 2026-06-13
**Branch:** `feat/privy-username-ens`
**Status:** Approved (design); implementing Part A (display) first.

## Problem

A logged-in player has an embedded Privy wallet but **no way to see it or its
balance** in the UI. After the username gate they drop straight into
`WorldCanvas`. They also have no way to **fund** that wallet. We want both: show
how much money the player holds, and let them add funds via **Blink**.

All chains are **Ethereum mainnet** (ENS + economy). Not Sepolia.

## Scope

- **Part A (build first):** Persistent HUD chip + wallet panel showing **USDC**
  and **ETH** balances, with copy-address.
- **Part B (next):** **Blink** "Add Funds" deposit button that lands USDC in the
  Privy wallet.

`$BTPA` balance is **deferred** until its contract is deployed.

## User-facing behavior

- A small **HUD chip** is always visible in a corner of the world:
  `username · $12.50 USDC`.
- Clicking the chip opens a **panel** (reusing the dark overlay/card styling
  from `UsernameGate`) containing:
  - Full wallet address + **Copy** button
  - Balances: **USDC** (the player's money) and **ETH** (gas)
  - **Add Funds** button (Part B; renders disabled/stub until Blink is wired)
- Balances refresh on open, on a ~10s poll while the panel is open, and
  immediately after a successful deposit.

## Architecture

### Part A — Balances

**Server** — new `GET /api/balances` (authenticated, same token pattern as
`/api/me`):
1. Resolve the user's wallet address from the Privy token (existing auth path).
2. Read balances with the existing mainnet `publicClient` (`server/src/chain/clients.ts`):
   - **USDC**: `balanceOf` on `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
     (mainnet USDC, **6 decimals**).
   - **ETH**: `getBalance`.
3. Return `{ usdc: string, eth: string }` (human-formatted decimal strings).

Keeping reads server-side keeps the RPC key private and reuses existing code.

**Client:**
- `auth/api.ts`: add `fetchBalances(token): Promise<{ usdc: string; eth: string }>`.
- New `ui/WalletHud.tsx`: the chip + expandable panel. Mounted in `App.tsx`
  once the user is in the world (alongside / above `WorldCanvas`). Reads the
  wallet address from Privy (`usePrivy().user.wallet.address`), polls
  `fetchBalances` while open.

### Part B — Blink deposit (next phase)

**Client:** `npm i @swype-org/deposit`. Panel's Add Funds button:
```ts
const { requestDeposit } = useBlinkDeposit({ signer: "/api/sign-payment" });
requestDeposit({ amount, chainId: 1, address: privyAddress, token: USDC_MAINNET });
```
On success → refetch balances.

**Server:** new `POST /api/sign-payment` — signs Blink's payload
(base64url JSON, SHA-256 + **ECDSA P-256**) and returns
`{ merchantId, payload, signature }`.

**Manual prerequisite (human, not code):** register a Blink merchant + generate
an ECDSA P-256 keypair in the Blink dashboard; set `BLINK_MERCHANT_ID` and
`BLINK_SIGNER_KEY` in `.env`. Until then the button renders but the flow can't
complete.

## Error handling

- `/api/balances` RPC failure → return last-known or `{ usdc: "—", eth: "—" }`;
  the HUD shows a muted dash rather than crashing.
- No wallet address yet (guest provisioning) → HUD hidden until address exists
  (mirrors the existing `user?.wallet?.address` gating in `App.tsx`).
- Deposit flow errors surface inline in the panel (Part B).

## Testing

- Server: unit test `/api/balances` — formats 6-decimal USDC and 18-decimal ETH
  correctly; returns the dash fallback on RPC error; rejects unauthenticated
  requests.
- Client: `fetchBalances` parses the response; WalletHud renders the chip,
  expands on click, and shows the dash fallback when balances are unavailable.

## Out of scope (YAGNI)

- `$BTPA` balance (no contract yet).
- USDC → $BTPA `convert` action (separate economy feature).
- Transaction history panel.
- Logout from the panel (can add later).
