# Stuck: username claim returns 409 ("registering subdomain" hangs)

**Date:** 2026-06-13
**Branch:** `feat/privy-username-ens`
**Status:** Root cause found + fix applied. Awaiting on-chain re-test.

## Symptom

After login, the username gate sat on **"Registering…"** and never advanced into
the world. Browser console showed:

```
Failed to load resource: the server responded with a status of 409 (Conflict)
```

The 409 came from `POST /api/claim-username`. Key clue from manual testing:
**the ENS subname WAS created on-chain, yet the request still returned 409.**

## Why there was no server log

The catch block in `claim-username` swallowed the error and returned a generic
409 without logging it (`server/src/auth/index.ts`). Fixed by adding:

```ts
console.error(`[claim-username] ENS mint failed for "${name}" -> ${address}:`, e);
```

(plus a matching log on the `setUsername` catch). Now the real revert reason
prints in the server terminal.

## Root cause

`ensureUserSubname` (`server/src/chain/ens.ts`) fired three transactions:

1. `setSubnodeRecord(parentNode, label, owner = USER, resolver, …)` → ✅ created
   the subname, **owned by the user**
2. `setAddr(node, user)` — sent from the **parent-owner wallet** → ❌ **reverted**
3. `setText(node, "avatar", …)` — never reached

Step 2 reverts because **only the node's current owner may set its resolver
records**. Once step 1 handed ownership to the user, the parent-owner wallet was
no longer authorised over that node, so `setAddr` reverted. But step 1 had
already landed → the subname exists, yet the endpoint throws → 409 → and because
the catch returns before `setUsername`, the username is never persisted. The
frontend keeps showing the gate → retry → same revert → **loop**.

This is exactly the rule the ENS docs call out in *"Creating a Subname Registrar
→ Setting Resolver Records"*: set records **while the registrar/owner still owns
the node**, then transfer ownership to the final owner.

## Fix applied

Minimal correct fix in `ensureUserSubname`: the **parent-owner wallet keeps
ownership** of the subname so it stays authorised to write the records. The user
is represented by the **`addr` record** (the name resolves to their wallet),
which is what we actually need for display/resolution.

- `setSubnodeRecord` owner arg: `USER` → `ensOwnerClient.account.address`
- `setAddr(node, userAddress)` and `setText(node, "avatar", …)` now succeed
- No ERC-1155 transfer / fuse / expiry handling needed

This avoids the alternative docs flow (temp-own → set records → transfer), which
is more fragile (expiry/fuse/balance pitfalls on the ERC-1155 transfer).

Re-testing the **same** name works because no fuses were burned, so the parent
wallet can reclaim the half-created subname and finish it.

## Gotcha: "the name shows in the ENS Manager, so it worked" (it didn't)

This is what made the bug confusing. The buggy first transaction
(`setSubnodeRecord`) **does** land on-chain, so the subname appears in the ENS
Manager app — but the flow still failed at `setAddr` (409). **A name appearing
in the manager ≠ the app flow succeeded.** For these orphaned names:

- `setSubnodeRecord` landed → name is listed ✅
- `setAddr` reverted → **no addr record**, so the name does NOT resolve to the
  user's wallet ❌
- backend threw → **username never persisted** → 409 → retry loop

### Reading the "Manager" badge

- **Manager** = your *controller* role on the name (can set records), vs
  **Owner** = holds the name/NFT.
- **Blue "Manager"** = your *currently-connected* wallet manages it.
  **Grey "Manager"** = the name's manager is a *different* address — likely a
  different embedded wallet from another login session. The old buggy code set
  `owner = the user's embedded wallet`, and that address can differ across
  guest/email logins, which is why some attempts show blue and others grey.
- Definitive check: click the name → compare its Owner/Manager addresses to your
  connected wallet. (ENS's exact color rule wasn't verified; treat the above as
  the working explanation.)

**Leftover orphaned names from the buggy attempts:** `sheepbig`, `bigsheep`,
`bigsheep1` (`*.bitopiaworld.eth`) — created but incomplete (no addr record).
The fix reclaims + finishes them on retry since no fuses were burned.

## How to verify

1. Server is on `tsx watch` (auto-reloads). Retry the username claim in the app.
2. Expected: `setSubnodeRecord` → `setAddr` ✅ → `setText` ✅ → `setUsername` →
   **200** → land in the world → wallet HUD (top-right) appears.
3. If it 409s again, read the `[claim-username] …` line in the server terminal
   for the exact revert.

## Open architectural question (flagged, not yet decided)

Every successful signup sends **~3 real Ethereum mainnet transactions** (gas per
user). For the demo, decide whether:

- every signup mints on-chain (current), or
- ENS minting moves behind an explicit "mint my ENS name" action, with a
  degraded/off-chain username path for dev (`ensConfigured()` already supports
  this when no owner key is set).

## Files touched

- `server/src/chain/ens.ts` — ownership-ordering fix in `ensureUserSubname`
- `server/src/auth/index.ts` — error logging on the two `claim-username` catches
