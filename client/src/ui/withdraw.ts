import { isAddress } from "viem";

// True for anything shaped like an ENS name (e.g. alice.bitopiaworld.eth or
// vitalik.eth): no whitespace, at least one dot, non-empty labels. This is a
// cheap shape check only — actual resolution happens on-chain at send time.
export function looksLikeEns(s: string): boolean {
  return /^[^\s.]+(\.[^\s.]+)+$/.test(s.trim());
}

// Validate a withdrawal request. Returns a human-readable reason the entry is
// unusable, or null when it's good to send. Kept pure (no React/SDK deps) so it
// is unit-testable and so the form can SHOW why an entry is rejected instead of
// silently disabling the button with no feedback. A destination may be a 0x hex
// address or an ENS name; the name is resolved to an address at send time.
export function withdrawError(
  dest: string,
  amount: string,
  balUsdc: number,
): string | null {
  if (!isAddress(dest) && !looksLikeEns(dest)) {
    return "Enter a valid 0x address or ENS name.";
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return "Enter an amount greater than 0.";
  if (Number.isFinite(balUsdc) && amt > balUsdc) return "Amount exceeds your USDC balance.";
  return null;
}
