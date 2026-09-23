import { describe, expect, it, vi } from "vitest";
import { handleStaleChunkLoad } from "./staleChunkRecovery";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("stale chunk recovery", () => {
  it("prevents the first stale import error and refreshes the app", () => {
    const event = Object.assign(new Event("vite:preloadError", { cancelable: true }), {
      payload: new TypeError("Failed to fetch dynamically imported module: /assets/Loans-old.js"),
    });
    const reload = vi.fn();

    expect(handleStaleChunkLoad(event, memoryStorage(), reload)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not loop when the same broken chunk fails after recovery", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const makeEvent = () => Object.assign(new Event("vite:preloadError", { cancelable: true }), {
      payload: new TypeError("Failed to fetch dynamically imported module: /assets/Loans-missing.js"),
    });

    expect(handleStaleChunkLoad(makeEvent(), storage, reload)).toBe(true);
    const repeated = makeEvent();
    expect(handleStaleChunkLoad(repeated, storage, reload)).toBe(false);
    expect(repeated.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
