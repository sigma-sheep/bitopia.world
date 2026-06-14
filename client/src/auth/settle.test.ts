import { describe, it, expect, vi } from "vitest";
import { scheduleSettleRefresh, SETTLE_DELAYS_MS } from "./settle";

describe("scheduleSettleRefresh", () => {
  // A submitted deposit/transfer changes the on-chain balance only once mined,
  // so a single immediate read is stale. The burst must start now (0ms) and
  // keep re-reading at increasing delays to catch settlement.
  it("starts immediately and uses ascending delays by default", () => {
    expect(SETTLE_DELAYS_MS[0]).toBe(0);
    for (let i = 1; i < SETTLE_DELAYS_MS.length; i++) {
      expect(SETTLE_DELAYS_MS[i]).toBeGreaterThan(SETTLE_DELAYS_MS[i - 1]);
    }
  });

  it("schedules one load at each delay", () => {
    const load = vi.fn();
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const setTimer = (fn: () => void, ms: number) => scheduled.push({ fn, ms }) - 1;

    scheduleSettleRefresh(load, [0, 1000, 5000], setTimer, () => {});

    expect(scheduled.map((s) => s.ms)).toEqual([0, 1000, 5000]);
    scheduled.forEach((s) => s.fn());
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("cancel() clears every pending timer", () => {
    let nextId = 0;
    const cleared: number[] = [];
    const setTimer = () => nextId++;
    const clearTimer = (id: number) => cleared.push(id);

    const cancel = scheduleSettleRefresh(() => {}, [0, 1000, 5000], setTimer, clearTimer);
    cancel();

    expect(cleared).toEqual([0, 1, 2]);
  });
});
