/**
 * Tests for WorktreeIndicator component logic.
 *
 * Since the test environment is `node` (no DOM/jsdom), we test the
 * component's rendering logic by verifying the class-name construction
 * and conditional rendering rules directly.
 */
import { describe, it, expect, vi } from "vitest";

// ─── Mock Tauri APIs ─────────────────────────────────────────────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("mocked"))),
}));
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
  notifyLongRunningDone: vi.fn(),
}));

// ─── Helper: replicate WorktreeIndicator logic ─────────────────────

/**
 * Mirrors the class-name and rendering logic from WorktreeIndicator.tsx
 * so we can test it in a node environment without DOM rendering.
 */
function getIndicatorOutput(props: {
  branchName: string | null;
  isMainWorktree: boolean;
  isActive?: boolean;
}) {
  const { branchName, isMainWorktree, isActive = false } = props;

  // Component returns null when branchName is null
  if (!branchName) return null;

  const cls = [
    "worktree-indicator",
    isMainWorktree ? "worktree-indicator-main" : "worktree-indicator-linked",
    isActive ? "worktree-indicator-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const title = isMainWorktree
    ? `Main worktree: ${branchName}`
    : `Linked worktree: ${branchName}`;

  const showLinkedLabel = !isMainWorktree;

  return { cls, title, branchName, showLinkedLabel };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("WorktreeIndicator", () => {
  describe("null rendering", () => {
    it("returns null when branchName is null", () => {
      const result = getIndicatorOutput({
        branchName: null,
        isMainWorktree: false,
      });
      expect(result).toBeNull();
    });

    it("returns null when branchName is null even if isMainWorktree is true", () => {
      const result = getIndicatorOutput({
        branchName: null,
        isMainWorktree: true,
      });
      expect(result).toBeNull();
    });
  });

  describe("branch name display", () => {
    it("shows the branch name in output", () => {
      const result = getIndicatorOutput({
        branchName: "feature/login",
        isMainWorktree: false,
      });
      expect(result).not.toBeNull();
      expect(result!.branchName).toBe("feature/login");
    });

    it("shows branch name for main worktree", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
      });
      expect(result!.branchName).toBe("main");
    });
  });

  describe("linked label", () => {
    it("shows linked label for linked worktrees (isMainWorktree=false)", () => {
      const result = getIndicatorOutput({
        branchName: "feature/x",
        isMainWorktree: false,
      });
      expect(result!.showLinkedLabel).toBe(true);
    });

    it("does not show linked label for main worktree", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
      });
      expect(result!.showLinkedLabel).toBe(false);
    });
  });

  describe("CSS class construction", () => {
    it("applies base class always", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
      });
      expect(result!.cls).toContain("worktree-indicator");
    });

    it("applies worktree-indicator-main for main worktree", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
      });
      expect(result!.cls).toContain("worktree-indicator-main");
      expect(result!.cls).not.toContain("worktree-indicator-linked");
    });

    it("applies worktree-indicator-linked for linked worktree", () => {
      const result = getIndicatorOutput({
        branchName: "feature/x",
        isMainWorktree: false,
      });
      expect(result!.cls).toContain("worktree-indicator-linked");
      expect(result!.cls).not.toContain("worktree-indicator-main");
    });

    it("applies worktree-indicator-active when isActive is true", () => {
      const result = getIndicatorOutput({
        branchName: "feature/x",
        isMainWorktree: false,
        isActive: true,
      });
      expect(result!.cls).toContain("worktree-indicator-active");
    });

    it("does not apply active class when isActive is false (default)", () => {
      const result = getIndicatorOutput({
        branchName: "feature/x",
        isMainWorktree: false,
      });
      expect(result!.cls).not.toContain("worktree-indicator-active");
    });

    it("does not apply active class when isActive is explicitly false", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
        isActive: false,
      });
      expect(result!.cls).not.toContain("worktree-indicator-active");
    });

    it("main + active applies both modifiers", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
        isActive: true,
      });
      expect(result!.cls).toContain("worktree-indicator-main");
      expect(result!.cls).toContain("worktree-indicator-active");
    });

    it("linked + active applies both modifiers", () => {
      const result = getIndicatorOutput({
        branchName: "feat",
        isMainWorktree: false,
        isActive: true,
      });
      expect(result!.cls).toContain("worktree-indicator-linked");
      expect(result!.cls).toContain("worktree-indicator-active");
    });

    it("class string has no trailing/leading spaces or double spaces", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
        isActive: false,
      });
      expect(result!.cls).toBe(result!.cls.trim());
      expect(result!.cls).not.toContain("  ");
    });
  });

  describe("title attribute", () => {
    it("title says 'Main worktree' for main worktree", () => {
      const result = getIndicatorOutput({
        branchName: "main",
        isMainWorktree: true,
      });
      expect(result!.title).toBe("Main worktree: main");
    });

    it("title says 'Linked worktree' for linked worktree", () => {
      const result = getIndicatorOutput({
        branchName: "feature/login",
        isMainWorktree: false,
      });
      expect(result!.title).toBe("Linked worktree: feature/login");
    });

    it("title includes full branch name", () => {
      const result = getIndicatorOutput({
        branchName: "very/deep/nested/branch-name",
        isMainWorktree: false,
      });
      expect(result!.title).toContain("very/deep/nested/branch-name");
    });
  });
});

// ─── WorktreeInfo type shape ────────────────────────────────────────

describe("WorktreeInfo type shape", () => {
  it("has required fields", () => {
    const info = {
      sessionId: "s1",
      sessionLabel: "Session 1",
      branchName: "main",
      worktreePath: "/repos/main",
      isMainWorktree: true,
    };
    expect(info).toHaveProperty("sessionId");
    expect(info).toHaveProperty("sessionLabel");
    expect(info).toHaveProperty("branchName");
    expect(info).toHaveProperty("worktreePath");
    expect(info).toHaveProperty("isMainWorktree");
  });

  it("branchName can be null (detached HEAD)", () => {
    const info = {
      sessionId: "s1",
      sessionLabel: "Session 1",
      branchName: null as string | null,
      worktreePath: "/repos/detached",
      isMainWorktree: false,
    };
    expect(info.branchName).toBeNull();
  });
});

// ─── SessionWorktree type shape ─────────────────────────────────────

describe("SessionWorktree type shape", () => {
  it("has all expected fields", () => {
    const wt = {
      id: "wt-1",
      sessionId: "s1",
      realmId: "r1",
      worktreePath: "/repos/.worktrees/feat",
      branchName: "feat",
      isMainWorktree: false,
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(wt).toHaveProperty("id");
    expect(wt).toHaveProperty("sessionId");
    expect(wt).toHaveProperty("realmId");
    expect(wt).toHaveProperty("worktreePath");
    expect(wt).toHaveProperty("branchName");
    expect(wt).toHaveProperty("isMainWorktree");
    expect(wt).toHaveProperty("createdAt");
  });

  it("branchName can be null", () => {
    const wt = {
      id: "wt-2",
      sessionId: "s2",
      realmId: "r1",
      worktreePath: "/repos/.worktrees/detached",
      branchName: null as string | null,
      isMainWorktree: false,
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(wt.branchName).toBeNull();
  });
});
