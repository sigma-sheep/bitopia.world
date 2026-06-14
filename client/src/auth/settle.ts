// A deposit or USDC transfer returns as soon as the tx is *submitted*, but the
// on-chain balance (what /api/balances reads) only changes once it's mined. So a
// single immediate re-fetch reads the stale, pre-tx number. This schedules a
// burst of re-fetches — now, then at increasing delays — so the HUD reflects the
// new balance once it settles, without the user having to reopen the panel.

// Spaced delays (ms after the action) that bracket typical mainnet settlement.
export const SETTLE_DELAYS_MS = [0, 3000, 8000, 15000, 30000];

// Schedule `load` to run at each delay. Returns a cancel fn that clears any
// still-pending re-fetches (call it on unmount, or before starting a new burst).
// The timer fns are injectable so the schedule is testable without real time.
export function scheduleSettleRefresh(
  load: () => void,
  delays: number[] = SETTLE_DELAYS_MS,
  setTimer: (fn: () => void, ms: number) => number = (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id: number) => void = (id) => window.clearTimeout(id),
): () => void {
  const ids = delays.map((ms) => setTimer(load, ms));
  return () => ids.forEach(clearTimer);
}
