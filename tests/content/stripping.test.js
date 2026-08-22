// @vitest-environment-options {"url": "https://www.youtube.com/watch?v=abc123"}
/**
 * stripping.test.js — tests for the declarative content script
 * (content/stripping.js), ticket #24.
 *
 * Follows the tests/blocked pattern for non-module page scripts: the
 * real script is dynamically imported (executing its top-level wiring)
 * against the installed chrome mock and jsdom. The jsdom URL above is
 * set to a YouTube page so the script's domain matching, overlay path,
 * and platform detection all engage.
 *
 * Covers:
 *  - the overlay delay decision (strip = 3s fixed, friction =
 *    frictionDelay || 15, block = no overlay) via the pure helper the
 *    script exposes on `self` for tests;
 *  - the once-per-URL guard: storage onChanged re-runs must NOT
 *    re-show the overlay for the same page;
 *  - countdown completion: Strip auto-dismisses the overlay at 0:00
 *    (no click); Friction persists at 0:00 until the button is clicked;
 *  - YouTube SPA navigation (yt-page-data-updated + URL change)
 *    re-applies the overlay with the correct delay;
 *  - master toggle off / site toggled off / block level → no overlay.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { flushMicrotasks } from "../helpers/dom-fixture.js";

const overlays = () => document.querySelectorAll("#mindfulbrowse-overlay").length;
const countdownText = () =>
  document.querySelector("#mindfulbrowse-overlay .countdown")?.textContent;

// Track listeners the content script adds to `window` so afterEach can
// detach them — otherwise every fresh module import accumulates another
// `yt-page-data-updated` handler that keeps firing in later tests.
const trackedWindowListeners = [];
const originalAddEventListener = window.addEventListener.bind(window);
const originalRemoveEventListener = window.removeEventListener.bind(window);

beforeAll(() => {
  window.addEventListener = (type, fn, opts) => {
    trackedWindowListeners.push([type, fn, opts]);
    return originalAddEventListener(type, fn, opts);
  };
});

beforeEach(() => {
  resetChromeMock();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  // Detach every window listener registered during the test.
  while (trackedWindowListeners.length > 0) {
    const [type, fn, opts] = trackedWindowListeners.pop();
    originalRemoveEventListener(type, fn, opts);
  }
  // Drop any overlay remnants so the next test starts clean.
  document
    .querySelectorAll("#mindfulbrowse-overlay, #mindfulbrowse-overlay-styles")
    .forEach((el) => el.remove());
});

/**
 * Fresh chrome mock + storage, then a fresh import of the content
 * script (its top level runs applyStrippingProfile() and registers
 * listeners). Fake timers are armed by beforeEach before this runs.
 */
async function loadStripping(sites, { enabled = true } = {}) {
  await chrome.storage.sync.set({ enabled, sites });
  vi.resetModules();
  await import("../../content/stripping.js");
  await flushMicrotasks();
}

describe("content script — overlay delay decision (#24)", () => {
  let getInterstitialDelaySeconds;

  beforeAll(async () => {
    // Import with empty storage so the top-level apply run is a no-op;
    // we only need the exposed pure helper here.
    resetChromeMock();
    vi.resetModules();
    await import("../../content/stripping.js");
    getInterstitialDelaySeconds =
      self.__mindfulBrowseStrippingInternals.getInterstitialDelaySeconds;
  });

  it("strip selects a fixed 3s delay", () => {
    expect(getInterstitialDelaySeconds({ restrictionLevel: "strip" })).toBe(3);
  });

  it("strip ignores frictionDelay — always 3s", () => {
    expect(
      getInterstitialDelaySeconds({ restrictionLevel: "strip", frictionDelay: 45 })
    ).toBe(3);
  });

  it("friction selects frictionDelay when present", () => {
    expect(
      getInterstitialDelaySeconds({ restrictionLevel: "friction", frictionDelay: 20 })
    ).toBe(20);
  });

  it("friction falls back to 15s when frictionDelay is missing", () => {
    expect(getInterstitialDelaySeconds({ restrictionLevel: "friction" })).toBe(15);
  });

  it("block selects no overlay (null)", () => {
    expect(getInterstitialDelaySeconds({ restrictionLevel: "block" })).toBeNull();
  });

  it("a legacy site without restrictionLevel is treated as strip (3s)", () => {
    expect(getInterstitialDelaySeconds({ domain: "youtube.com" })).toBe(3);
  });

  // m3 — corrupt frictionDelay must never produce a broken countdown or a
  // stuck overlay; only a finite positive number is honored (rounded up).
  it("m3: corrupt frictionDelay (negative) clamps to the 15s default", () => {
    expect(getInterstitialDelaySeconds({ restrictionLevel: "friction", frictionDelay: -5 })).toBe(15);
  });

  it("m3: corrupt frictionDelay (NaN / zero / non-numeric) clamps to the 15s default", () => {
    expect(getInterstitialDelaySeconds({ restrictionLevel: "friction", frictionDelay: NaN })).toBe(15);
    expect(getInterstitialDelaySeconds({ restrictionLevel: "friction", frictionDelay: 0 })).toBe(15);
    expect(getInterstitialDelaySeconds({ restrictionLevel: "friction", frictionDelay: "soon" })).toBe(15);
  });

  it("m3: fractional frictionDelay rounds up", () => {
    expect(getInterstitialDelaySeconds({ restrictionLevel: "friction", frictionDelay: 7.2 })).toBe(8);
  });
});

describe("content script — overlay display and once-per-URL guard (#24)", () => {
  it("strip shows the overlay once with a 3s countdown", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "strip" },
    ]);

    expect(overlays()).toBe(1);
    expect(countdownText()).toBe("0:03");
  });

  it("friction shows the overlay with frictionDelay (or 15s default)", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "friction", frictionDelay: 8 },
    ]);
    expect(overlays()).toBe(1);
    expect(countdownText()).toBe("0:08");

    // Clean slate, then the 15s default.
    document.querySelectorAll("#mindfulbrowse-overlay, #mindfulbrowse-overlay-styles")
      .forEach((el) => el.remove());
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "friction" },
    ]);
    expect(overlays()).toBe(1);
    expect(countdownText()).toBe("0:15");
  });

  it("block shows no overlay (background already redirected)", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "block" },
    ]);
    expect(overlays()).toBe(0);
  });

  it("strip overlay auto-dismisses at 0:00 without a button click", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "strip" },
    ]);
    expect(overlays()).toBe(1);

    // Run the 3s countdown out — the overlay must start fading WITHOUT
    // any click (spec: "3s breathing overlay, THEN stripped page").
    await vi.advanceTimersByTimeAsync(3000);
    expect(countdownText()).toBe("0:00");
    const overlay = document.querySelector("#mindfulbrowse-overlay");
    expect(overlay.classList.contains("fade-out")).toBe(true);

    // After the 0.5s fade the overlay and its styles are removed.
    await vi.advanceTimersByTimeAsync(500);
    expect(overlays()).toBe(0);
    expect(document.getElementById("mindfulbrowse-overlay-styles")).toBeNull();
  });

  it("friction overlay persists at 0:00 until the button is clicked", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "friction", frictionDelay: 5 },
    ]);
    expect(overlays()).toBe(1);

    // At 0:00 the overlay is still standing — only the button enables.
    await vi.advanceTimersByTimeAsync(5000);
    expect(countdownText()).toBe("0:00");
    expect(overlays()).toBe(1);
    const btn = document.querySelector("#mindfulbrowse-overlay .btn-proceed");
    expect(btn.disabled).toBe(false);

    // Still there long after 0:00 — no auto-dismiss for Friction.
    await vi.advanceTimersByTimeAsync(5000);
    expect(overlays()).toBe(1);

    // The click is the only exit.
    btn.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(overlays()).toBe(0);
  });

  it("does not re-show the overlay when applyStrippingProfile re-runs for the same URL", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "strip" },
    ]);
    expect(overlays()).toBe(1);

    // A popup write re-triggers applyStrippingProfile via sync onChanged.
    await chrome.storage.sync.set({
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await flushMicrotasks();
    expect(overlays()).toBe(1);

    // A YouTube SPA event WITHOUT a URL change must not re-show either.
    window.dispatchEvent(new Event("yt-page-data-updated"));
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(overlays()).toBe(1);
  });

  it("re-applies the overlay when a YouTube SPA navigation changes the URL (no stacking)", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "strip" },
    ]);
    expect(overlays()).toBe(1);

    // SPA navigation: URL actually changed, then yt-page-data-updated fires.
    history.pushState({}, "", "/watch?v=def456");
    window.dispatchEvent(new Event("yt-page-data-updated"));
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    // M4: the previous overlay is torn down before the new one is built —
    // exactly one live overlay, never a stack.
    expect(overlays()).toBe(1);
    expect(countdownText()).toBe("0:03");

    // A second SPA navigation must not accumulate a duplicate either.
    history.pushState({}, "", "/watch?v=ghi789");
    window.dispatchEvent(new Event("yt-page-data-updated"));
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(overlays()).toBe(1);
  });

  it("shows no overlay when the master toggle is off", async () => {
    await loadStripping(
      [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
      { enabled: false }
    );
    expect(overlays()).toBe(0);
  });

  it("shows no overlay when the site is toggled off", async () => {
    await loadStripping([
      { domain: "youtube.com", active: false, restrictionLevel: "strip" },
    ]);
    expect(overlays()).toBe(0);
  });

  it("m2: flipping a live strip page to block tears down the standing overlay", async () => {
    await loadStripping([
      { domain: "youtube.com", active: true, restrictionLevel: "strip" },
    ]);
    expect(overlays()).toBe(1);

    // Popup flips the site to Block mid-countdown; the sync onChanged write
    // re-runs applyStrippingProfile, which must drop the live overlay.
    await chrome.storage.sync.set({
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "block" }],
    });
    await flushMicrotasks();

    expect(overlays()).toBe(0);
  });
});
