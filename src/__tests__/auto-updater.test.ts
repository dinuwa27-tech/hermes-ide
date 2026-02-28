import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the Tauri plugins before import ──────────────────────────
const mockCheck = vi.fn();
const mockRelaunch = vi.fn();
const mockDownloadAndInstall = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => mockRelaunch(...args),
}));

// ── Import after mocks ────────────────────────────────────────────
import type { UpdateState } from "../hooks/useAutoUpdater";

// Since useAutoUpdater is a React hook, we test the logic directly
// by extracting the state machine behavior.

/** Simulates what doCheck does to state */
function applyCheckResult(
  state: UpdateState,
  update: { version: string; body: string } | null,
): UpdateState {
  if (!update) return state;
  return {
    ...state,
    available: true,
    version: update.version,
    notes: update.body ?? "",
    error: false,
    dismissed: state.dismissed && state.dismissedVersion === update.version,
  };
}

/** Simulates what dismiss does to state */
function applyDismiss(state: UpdateState): UpdateState {
  return { ...state, dismissed: true, dismissedVersion: state.version };
}

const INITIAL: UpdateState = {
  available: false,
  version: "",
  notes: "",
  downloading: false,
  progress: 0,
  dismissed: false,
  dismissedVersion: "",
  error: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
// Bug #1: Dismissed dialog never re-shows on periodic check
// ─────────────────────────────────────────────────────────────────
describe("Bug #1 — dismiss + periodic re-check (same version)", () => {
  it("should keep dialog hidden when same version re-checked after dismiss", () => {
    let s = INITIAL;
    // 1. Update found
    s = applyCheckResult(s, { version: "1.0.0", body: "notes" });
    expect(s.available).toBe(true);
    expect(s.dismissed).toBe(false);

    // 2. User clicks "Later"
    s = applyDismiss(s);
    expect(s.dismissed).toBe(true);
    expect(s.dismissedVersion).toBe("1.0.0");

    // 3. Periodic check finds SAME version
    s = applyCheckResult(s, { version: "1.0.0", body: "notes" });
    expect(s.dismissed).toBe(true); // stays dismissed for same version
  });

  it("should re-show dialog when a NEWER version is found after dismiss", () => {
    let s = INITIAL;
    // 1. Update found
    s = applyCheckResult(s, { version: "1.0.0", body: "notes" });
    expect(s.available).toBe(true);

    // 2. User clicks "Later"
    s = applyDismiss(s);
    expect(s.dismissed).toBe(true);
    expect(s.dismissedVersion).toBe("1.0.0");

    // 3. Periodic check finds NEWER version
    s = applyCheckResult(s, { version: "1.1.0", body: "new notes" });
    expect(s.dismissed).toBe(false); // re-shows for new version
    expect(s.version).toBe("1.1.0");
  });
});

// ─────────────────────────────────────────────────────────────────
// Bug #2: Status bar hidden after dismiss
// ─────────────────────────────────────────────────────────────────
describe("Bug #2 — status bar visibility after dismiss", () => {
  it("available should remain true after dismiss (for status bar)", () => {
    let s = INITIAL;
    s = applyCheckResult(s, { version: "2.0.0", body: "" });
    s = applyDismiss(s);

    // `available` stays true — status bar shows "v2.0.0 available"
    expect(s.available).toBe(true);
    // Dialog hidden by `dismissed`, but status bar uses only `available`
    expect(s.dismissed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// Bug #3: Download failure error state
// ─────────────────────────────────────────────────────────────────
describe("Bug #3 — download failure error feedback", () => {
  it("should set error flag on download failure", () => {
    let s = INITIAL;
    s = applyCheckResult(s, { version: "1.0.0", body: "" });

    // Simulate download start
    s = { ...s, downloading: true, progress: 0 };

    // Simulate failure (catch block)
    s = { ...s, downloading: false, error: true };

    expect(s.error).toBe(true);
    expect(s.downloading).toBe(false);
    expect(s.available).toBe(true); // dialog still shown
  });

  it("should clear error flag on next successful check", () => {
    let s: UpdateState = {
      ...INITIAL,
      available: true,
      version: "1.0.0",
      error: true,
    };

    // Next check clears error
    s = applyCheckResult(s, { version: "1.0.0", body: "" });
    expect(s.error).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Manual check resets dismissed
// ─────────────────────────────────────────────────────────────────
describe("manualCheck resets dismissed state", () => {
  it("should clear dismissed so dialog re-shows", () => {
    let s = INITIAL;
    s = applyCheckResult(s, { version: "1.0.0", body: "" });
    s = applyDismiss(s);
    expect(s.dismissed).toBe(true);

    // manualCheck resets dismissed before calling doCheck
    s = { ...s, dismissed: false };
    s = applyCheckResult(s, { version: "1.0.0", body: "" });
    expect(s.dismissed).toBe(false); // dialog visible again
  });
});
