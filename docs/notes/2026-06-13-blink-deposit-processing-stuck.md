# Stuck: Blink deposit hangs on "Processing Deposit" (no funds transferred)

**Date:** 2026-06-13
**Branch:** `feat/blink-integration`
**Status:** Our integration verified correct end-to-end through passkey auth.
Hang is inside Blink's hosted flow. Leading hypothesis: **localhost origin
mismatch** vs the registered merchant domain. Not yet resolved — needs an HTTPS
test on the registered domain and/or Blink support.

## Symptom

Clicking **Add funds** opens Blink's hosted deposit popup, the user authorizes
with a passkey (Touch ID), then the popup sits on **"Processing Deposit"**
forever. **The wallet's on-chain USDC balance never changes** — no funds move.

## What is VERIFIED WORKING on our side (do not re-debug these)

The flow passes every stage we own, in order:

1. **Signer** — `POST /api/sign-payment` (`server/src/chain/blink.ts`) signs the
   base64url payload with ECDSA P-256; signature verifies against the public
   key (9 unit tests in `blink.test.ts`). Initially returned `503` only because
   `BLINK_MERCHANT_ID` was unset; fixed once the merchant id was added to `.env`.
2. **Iframe + bridge** — Blink's `pay.blink.cash` iframe mounts; the EIP-6963
   wallet bridge advertises wallets (`[blink-bridge:parent] advertising wallets (2)`).
3. **Fingerprint** — passes once the browser content blocker is off (see below).
4. **Passkey authorization** — `[blink-sdk] Transfer signing WebAuthn request …`;
   Touch ID prompt appears and the user approves it. **The transfer is authorized.**

Everything that fails after this point is **inside Blink's hosted app**
(`pay.blink.cash`), which we cannot change.

## The diagnostic journey (red herrings ruled out)

- **`503` from `/api/sign-payment`** → `BLINK_MERCHANT_ID` was empty. Fixed.
- **`ERR_BLOCKED_BY_CLIENT` on `fpnpmcdn.net` (FingerprintJS) + Sentry** →
  a browser content blocker (**Brave Shields** / ad blocker) blocked the
  fingerprint script Blink needs; flow stalled. **Fix: disable Shields/blocker
  for the site.** Cleared by turning Shields off.
- **WebAuthn passkey step** → suspected Brave blocked the cross-origin passkey
  ceremony. Retried in plain **Chrome**; Touch ID prompt appeared and was
  approved. Ruled out — passkey works.
- **`c.ba.contentsquare.net` CORS error (`baggage` header not allowed)** →
  harmless ContentSquare **analytics** noise. Not the blocker. Ignore.
- **Merchant PENDING / env mismatch** → ruled out. Merchant
  `a06b3a03-436c-4a0e-b2c5-42e0dd29ce5e` is **APPROVED** and registered on
  **production** (`api.blink.cash`); client is `VITE_BLINK_ENV=production`
  loading `pay.blink.cash`. Consistent.

## The terminal error (what shows after it hangs)

```
SecurityError: Failed to read a named property 'ethereum' from 'Window':
Blocked a frame with origin "https://pay.blink.cash" from accessing a cross-origin frame.
  at Object.getProvider (index-A5OQ2Y7z.js …)
  at t7e.initialize (index-C4ElhlFd.js …)   // Blink's EthereumWalletConnector
```

Blink's hosted flow tries to read `window.ethereum` directly from the **parent**
page (`localhost:5173`) to connect a funding wallet, and the browser blocks the
cross-origin access. With no funding wallet connected, the deposit can't settle.

**Note:** this `SecurityError` by itself is *not* localhost-specific — a
cross-origin iframe can't read the parent's `window.ethereum` from any domain;
Blink's bridge is meant to handle that. The localhost angle (below) is about
*why the bridge/settlement doesn't complete*, not about this raw error.

## Leading hypothesis: localhost origin mismatch

The merchant was registered with `domain: "bitopia.world"`, but the app is served
from `http://localhost:5173`. Payment-iframe flows commonly gate the wallet
bridge / settlement on the **embedding origin matching the registered/allowlisted
domain**. If `localhost:5173` isn't allowlisted for this merchant, the trusted
bridge never establishes → the connector falls back to a direct `window.ethereum`
read → `SecurityError` → no funding wallet → **no settlement → no money moved.**

Supporting evidence:
- Blink's integration guide says to test on mobile via a **public tunnel instead
  of localhost**.
- The production checklist requires **HTTPS**. Blink expects a real HTTPS origin,
  not `http://localhost`.

## Next steps (to confirm / resolve)

1. **Serve from an origin Blink trusts** — strongest test:
   - Deploy the frontend to **`bitopia.world` over HTTPS** and retry there
     (matches the registered merchant domain), OR
   - **HTTPS tunnel** (`cloudflared tunnel --url http://localhost:5173` / ngrok).
     Caveat: the tunnel domain ≠ `bitopia.world`, so if Blink enforces domain
     allowlisting you may also need a merchant registered for that domain.
2. **Validate on sandbox** (no real funds) to see if the hang is
   environment-specific. Sandbox is a separate registry that auto-approves;
   register the same `secrets/blink-public.pem` at
   `https://api-sandbox.blink.cash/v1/merchants/applications`, set
   `VITE_BLINK_ENV=sandbox` + both merchant-id vars to the sandbox id.
3. **Ask Blink support** (message drafted in chat): does the hosted deposit flow
   require the embedding origin to match the registered merchant `domain`? Is
   `localhost` supported? Which funding sources work in-iframe? Is there a
   required `allow`/permissions attribute or a popup/redirect mode instead of the
   iframe? Reference the `SecurityError` stack above and
   `merchantId a06b3a03-…`, mainnet USDC destination.

## Hardening shipped on our side (working, tested)

In `client/src/ui/WalletHud.tsx` (env-driven, so we can switch without code edits):
- `VITE_BLINK_ENV` → SDK `environment` (sandbox/production toggle)
- `flowTimeoutMs: 120000` backstop — a dead hang now rejects with `FLOW_TIMEOUT`
  instead of spinning forever
- `VITE_BLINK_DEBUG` → SDK `debug` lifecycle logging
- Non-alarming UX: `FLOW_TIMEOUT` shows "Still processing — your balance will
  update automatically if it completes"; user-dismissed popups are silent

These are documented in `.env.example`.

## Gotcha: blocked trackers and analytics noise look like the bug (they aren't)

The console is dominated by two harmless classes of error that are easy to
mistake for the cause:
- `contentscript.js` warnings (`MaxListenersExceededWarning`, `ObjectMultiplex
  orphaned data`) — from the MetaMask/Brave wallet extension. Ignore.
- `c.ba.contentsquare.net` CORS `baggage`-header failures — ContentSquare
  analytics. Ignore.

The only lines that matter are the `[blink-sdk]` / `[blink-bridge]` logs and the
final `SecurityError`.

## Files involved

- `server/src/chain/blink.ts` — signer endpoint (+ `blink.test.ts`)
- `server/src/index.ts` — mounts `registerBlink`
- `server/src/config.ts` — `blinkMerchantId`, `blinkSignerKey`
- `client/src/ui/WalletHud.tsx` — `useBlinkDeposit` wiring + hardening
- `.env` / `.env.example` — `BLINK_MERCHANT_ID`, `BLINK_SIGNER_KEY`,
  `VITE_BLINK_ENV`, `VITE_BLINK_MERCHANT_ID`, `VITE_BLINK_DEBUG`
- `secrets/blink-{private,public}.pem` — ECDSA P-256 keypair (gitignored)
