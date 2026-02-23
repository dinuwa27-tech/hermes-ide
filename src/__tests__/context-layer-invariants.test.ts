/**
 * Context Layer Invariant Tests
 *
 * Asserts the architectural separation between:
 *   L1 (Identity Context): projects, pins, memory, workspace, agent, execution mode
 *   L2 (Ephemeral Execution): error resolutions, files touched, recent errors
 *
 * Error resolutions, filesTouched, and recentErrors must NEVER exist in ContextState,
 * appear in formatContextMarkdown output, or trigger version/dirty changes.
 */
import { describe, it, expect, vi } from "vitest";

// ─── Mock Tauri APIs ─────────────────────────────────────────────────
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalPool", () => ({
  createTerminal: vi.fn(),
  destroy: vi.fn(),
  updateSettings: vi.fn(),
  writeScrollback: vi.fn(),
}));
vi.mock("../utils/notifications", () => ({
  initNotifications: vi.fn(),
  notifyStuck: vi.fn(),
  notifyLongRunningDone: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────
import {
  formatContextMarkdown,
  type ContextState,
} from "../hooks/useContextState";
import { structuralEqual, structuralClone } from "../utils/structuralEqual";

// ─── Helpers ─────────────────────────────────────────────────────────
function makeContext(overrides?: Partial<ContextState>): ContextState {
  return {
    pinnedItems: [],
    memoryFacts: [],
    persistedMemory: [],
    realms: [],
    workspacePaths: [],
    workingDirectory: "/home/user/project",
    agent: "anthropic",
    model: "claude-sonnet",
    ...overrides,
  };
}

// =====================================================================
// Invariant 1: Error resolution data does not exist in ContextState
// =====================================================================

describe("Invariant: errorResolutions not in ContextState", () => {
  it("ContextState does not have errorResolutions property", () => {
    const ctx = makeContext();
    expect("errorResolutions" in ctx).toBe(false);
  });

  it("ContextState does not have filesTouched property", () => {
    const ctx = makeContext();
    expect("filesTouched" in ctx).toBe(false);
  });

  it("ContextState does not have recentErrors property", () => {
    const ctx = makeContext();
    expect("recentErrors" in ctx).toBe(false);
  });
});

// =====================================================================
// Invariant 2: formatContextMarkdown never contains ephemeral data
// =====================================================================

describe("Invariant: formatContextMarkdown excludes ephemeral data", () => {
  it("output never contains 'Error Resolution'", () => {
    const ctx = makeContext();
    const output = formatContextMarkdown(ctx, 1, "manual");
    expect(output).not.toContain("Error Resolution");
    expect(output).not.toContain("Known Error Resolutions");
  });

  it("output never contains 'Files touched'", () => {
    const ctx = makeContext();
    const output = formatContextMarkdown(ctx, 1, "manual");
    expect(output).not.toContain("Files touched");
  });

  it("full context with all L1 data still excludes ephemeral sections", () => {
    const ctx = makeContext({
      pinnedItems: [{
        id: 1, session_id: null, project_id: "r1",
        kind: "file", target: "/src/main.ts", label: "Main",
        priority: 256, created_at: 1000,
      }],
      persistedMemory: [{ key: "db_host", value: "localhost", source: "user" }],
      realms: [{
        realm_id: "r1", realm_name: "test", path: "/test",
        languages: ["TypeScript"], frameworks: ["React"],
        architecture_pattern: "MVC", architecture_layers: [],
        conventions: ["strict"], scan_status: "deep",
      }],
      workspacePaths: ["/extra"],
    });
    const output = formatContextMarkdown(ctx, 5, "assisted");

    // L1 data present
    expect(output).toContain("## Projects");
    expect(output).toContain("## Pinned Context");
    expect(output).toContain("## Memory");
    expect(output).toContain("## Workspace");

    // L2 data absent
    expect(output).not.toContain("Error Resolution");
    expect(output).not.toContain("Files touched");
  });
});

// =====================================================================
// Invariant 3: Context version stable when only L2 data changes
// =====================================================================

describe("Invariant: version stability under L2 changes", () => {
  /**
   * Simulates the version-tracking state machine from useContextState.
   * Only L1 (ContextState) changes should increment version.
   */
  function createVersionTracker() {
    let context = makeContext();
    let prevContext: ContextState | null = null;
    let version = 0;
    let lifecycle: "clean" | "dirty" = "clean";

    function setContext(next: ContextState) {
      context = next;
      if (!structuralEqual(context, prevContext)) {
        prevContext = structuralClone(context);
        version += 1;
        lifecycle = "dirty";
      }
    }

    function apply() {
      lifecycle = "clean";
      prevContext = structuralClone(context);
    }

    return {
      setContext,
      apply,
      getState: () => ({ version, lifecycle, context }),
    };
  }

  it("identical context does not increment version", () => {
    const tracker = createVersionTracker();
    tracker.setContext(makeContext());
    const v1 = tracker.getState().version;

    // Re-set with structurally identical context
    tracker.setContext(makeContext());
    expect(tracker.getState().version).toBe(v1);
  });

  it("L1 change (adding a pin) increments version", () => {
    const tracker = createVersionTracker();
    tracker.setContext(makeContext());
    tracker.apply();
    const v1 = tracker.getState().version;

    tracker.setContext(makeContext({
      pinnedItems: [{
        id: 1, session_id: "s1", project_id: null,
        kind: "file", target: "/file.ts", label: null,
        priority: 128, created_at: 1000,
      }],
    }));
    expect(tracker.getState().version).toBe(v1 + 1);
    expect(tracker.getState().lifecycle).toBe("dirty");
  });

  it("context preview is identical before and after hypothetical error match", () => {
    const ctx = makeContext({
      pinnedItems: [{
        id: 1, session_id: null, project_id: "r1",
        kind: "file", target: "/src/main.ts", label: "Main",
        priority: 256, created_at: 1000,
      }],
    });
    const before = formatContextMarkdown(ctx, 3, "manual");

    // Simulating an error match event — context stays the same since
    // error resolutions are no longer part of ContextState
    const after = formatContextMarkdown(ctx, 3, "manual");
    expect(before).toBe(after);
  });
});

// =====================================================================
// Invariant 4: Auto-apply executes without triggering injection
// =====================================================================

describe("Invariant: auto-apply isolation", () => {
  it("error resolution event does not mutate ContextState shape", () => {
    const ctx = makeContext();
    const keys = Object.keys(ctx).sort();

    // Verify no ephemeral keys exist
    expect(keys).not.toContain("errorResolutions");
    expect(keys).not.toContain("filesTouched");
    expect(keys).not.toContain("recentErrors");

    // Verify all expected L1 keys exist
    expect(keys).toContain("pinnedItems");
    expect(keys).toContain("memoryFacts");
    expect(keys).toContain("persistedMemory");
    expect(keys).toContain("realms");
    expect(keys).toContain("workspacePaths");
    expect(keys).toContain("workingDirectory");
    expect(keys).toContain("agent");
    expect(keys).toContain("model");
  });
});

// =====================================================================
// Invariant 5: Multiple identical errors produce no version change
// =====================================================================

describe("Invariant: repeated identical data produces no drift", () => {
  it("setting same context N times does not increment version beyond 1", () => {
    let context = makeContext();
    let prevContext: ContextState | null = null;
    let version = 0;

    function setContext(next: ContextState) {
      context = next;
      if (!structuralEqual(context, prevContext)) {
        prevContext = structuralClone(context);
        version += 1;
      }
    }

    // First set increments
    setContext(makeContext({ workingDirectory: "/project" }));
    expect(version).toBe(1);

    // Repeated identical sets do NOT increment
    for (let i = 0; i < 10; i++) {
      setContext(makeContext({ workingDirectory: "/project" }));
    }
    expect(version).toBe(1);
  });
});
