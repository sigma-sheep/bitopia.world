// Lightweight pub/sub so a balance-changing action in one component (e.g. a
// player-to-player transfer in PlayerMenu) can tell the WalletHud — a sibling
// with its own state and no shared store — to re-fetch. Kept deliberately tiny:
// the HUD is the only subscriber today, but routing every action through one
// signal means new send paths get HUD refresh for free.

type Listener = () => void;
const listeners = new Set<Listener>();

// Subscribe to balance-change signals. Returns an unsubscribe fn.
export function onBalanceChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Signal that a balance-changing tx was just submitted. Subscribers re-fetch
// (with their own settlement retries — see scheduleSettleRefresh).
export function notifyBalanceChanged(): void {
  listeners.forEach((fn) => fn());
}
