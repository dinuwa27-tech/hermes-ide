/**
 * Bug fix regression tests.
 *
 * Each test covers a specific bug that was found and fixed:
 * 1. contextAnalyzer — caching error fallbacks permanently
 * 2. mergeRoles — orphan "." from empty stripped string
 * 3. validateCustomStyle — asymmetric trim in duplicate check
 * 4. validateCustomRole — asymmetric trim in duplicate check
 * 5. encoding.ts — O(n²) string concatenation (correctness)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock Tauri APIs ─────────────────────────────────────────────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────
import { mergeRoles, validateCustomRole, type RoleDefinition } from "../lib/roles";
import { validateCustomStyle, type StyleDefinition } from "../lib/styles";
import { utf8ToBase64 } from "../utils/encoding";

// =============================================================================
// 1. contextAnalyzer — error fallbacks should NOT be cached
// =============================================================================
describe("contextAnalyzer — error fallback caching", () => {
  // We need to re-import fresh module for each test to reset the cache
  let detectProjectContext: typeof import("../terminal/intelligence/contextAnalyzer").detectProjectContext;
  let getCachedContext: typeof import("../terminal/intelligence/contextAnalyzer").getCachedContext;
  let invalidateContext: typeof import("../terminal/intelligence/contextAnalyzer").invalidateContext;

  const invoke = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    // Re-mock after module reset
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const mod = await import("../terminal/intelligence/contextAnalyzer");
    detectProjectContext = mod.detectProjectContext;
    getCachedContext = mod.getCachedContext;
    invalidateContext = mod.invalidateContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT cache error fallbacks — subsequent calls retry the backend", async () => {
    // First call: backend fails
    invoke.mockRejectedValueOnce(new Error("network error"));
    const fallback = await detectProjectContext("/some/path");

    // Should return the fallback (not throw)
    expect(fallback.hasGit).toBe(false);
    expect(fallback.packageManager).toBeNull();

    // getCachedContext should return null — error was NOT cached
    expect(getCachedContext("/some/path")).toBeNull();

    // Second call: backend succeeds
    invoke.mockResolvedValueOnce({
      hasGit: true,
      packageManager: "npm",
      languages: ["typescript"],
      frameworks: ["react"],
    });
    const result = await detectProjectContext("/some/path");

    // Should return the real data, not the stale fallback
    expect(result.hasGit).toBe(true);
    expect(result.packageManager).toBe("npm");
  });

  it("DOES cache successful results", async () => {
    invoke.mockResolvedValueOnce({
      hasGit: true,
      packageManager: "yarn",
      languages: ["python"],
      frameworks: [],
    });

    await detectProjectContext("/project");
    const cached = getCachedContext("/project");

    expect(cached).not.toBeNull();
    expect(cached!.hasGit).toBe(true);
    expect(cached!.packageManager).toBe("yarn");
  });

  it("invalidateContext clears the cache for a given path", async () => {
    invoke.mockResolvedValueOnce({
      hasGit: true,
      packageManager: "npm",
      languages: [],
      frameworks: [],
    });

    await detectProjectContext("/old/path");
    expect(getCachedContext("/old/path")).not.toBeNull();

    invalidateContext("/old/path");
    expect(getCachedContext("/old/path")).toBeNull();
  });
});

// =============================================================================
// 2. mergeRoles — empty stripped string should NOT produce orphan "."
// =============================================================================
describe("mergeRoles — empty string after regex stripping", () => {
  it("does NOT produce orphan '.' when regex strips instruction to empty", () => {
    // Custom roles where systemInstruction is exactly "You are a X with "
    // (trailing "with " gets stripped to empty string)
    const roles: RoleDefinition[] = [
      {
        id: "a",
        label: "Role A",
        systemInstruction: "You are a wizard with ",
        builtIn: false,
      },
      {
        id: "b",
        label: "Role B",
        systemInstruction: "You are a warrior who ",
        builtIn: false,
      },
    ];

    const result = mergeRoles(["a", "b"], roles);

    // Should have the opening but NO orphan "." from empty capabilities
    expect(result).not.toContain(" .");
    expect(result).not.toMatch(/\.\s*\.$/);
    // The result should just be the opening sentence (no capabilities)
    expect(result).toBe("You are a Role A and Role B.");
  });

  it("still includes non-empty capabilities after stripping", () => {
    const roles: RoleDefinition[] = [
      {
        id: "a",
        label: "Role A",
        systemInstruction: "You are a wizard with powerful magic.",
        builtIn: false,
      },
      {
        id: "b",
        label: "Role B",
        systemInstruction: "You are a warrior who fights bravely.",
        builtIn: false,
      },
    ];

    const result = mergeRoles(["a", "b"], roles);

    expect(result).toContain("Powerful magic.");
    expect(result).toContain("Fights bravely.");
  });

  it("handles whitespace-only stripped result gracefully", () => {
    const roles: RoleDefinition[] = [
      {
        id: "a",
        label: "Role A",
        systemInstruction: "You are a wizard with   ",
        builtIn: false,
      },
      {
        id: "b",
        label: "Role B",
        systemInstruction: "Normal instruction without pattern",
        builtIn: false,
      },
    ];

    const result = mergeRoles(["a", "b"], roles);
    // No orphan "." — the whitespace-only result should be skipped
    expect(result).not.toContain(" .");
  });
});

// =============================================================================
// 3. validateCustomStyle — asymmetric trim in duplicate check
// =============================================================================
describe("validateCustomStyle — trim consistency in duplicate check", () => {
  it("detects duplicates even when existing label has whitespace", () => {
    const existing: StyleDefinition[] = [
      {
        id: "ws-style",
        label: "  My Style  ",
        levels: ["a", "b", "c", "d", "e"],
        builtIn: false,
      },
    ];

    const result = validateCustomStyle(
      { label: "My Style", levels: ["1", "2", "3", "4", "5"] },
      existing,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("detects duplicates when input label has whitespace", () => {
    const existing: StyleDefinition[] = [
      {
        id: "normal-style",
        label: "My Style",
        levels: ["a", "b", "c", "d", "e"],
        builtIn: false,
      },
    ];

    const result = validateCustomStyle(
      { label: "  My Style  ", levels: ["1", "2", "3", "4", "5"] },
      existing,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("detects duplicates with mixed whitespace and case", () => {
    const existing: StyleDefinition[] = [
      {
        id: "mixed-style",
        label: "  Concise  ",
        levels: ["a", "b", "c", "d", "e"],
        builtIn: false,
      },
    ];

    const result = validateCustomStyle(
      { label: "concise", levels: ["1", "2", "3", "4", "5"] },
      existing,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("allows truly different labels", () => {
    const existing: StyleDefinition[] = [
      {
        id: "existing",
        label: "  My Style  ",
        levels: ["a", "b", "c", "d", "e"],
        builtIn: false,
      },
    ];

    const result = validateCustomStyle(
      { label: "Different Style", levels: ["1", "2", "3", "4", "5"] },
      existing,
    );

    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// 4. validateCustomRole — asymmetric trim in duplicate check
// =============================================================================
describe("validateCustomRole — trim consistency in duplicate check", () => {
  it("detects duplicates even when existing label has whitespace", () => {
    const existing: RoleDefinition[] = [
      {
        id: "ws-role",
        label: "  My Role  ",
        systemInstruction: "You are a role.",
        builtIn: false,
      },
    ];

    const result = validateCustomRole(
      { label: "My Role", systemInstruction: "Some instruction" },
      existing,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("detects duplicates when input label has whitespace", () => {
    const existing: RoleDefinition[] = [
      {
        id: "normal-role",
        label: "My Role",
        systemInstruction: "You are a role.",
        builtIn: false,
      },
    ];

    const result = validateCustomRole(
      { label: "  My Role  ", systemInstruction: "Some instruction" },
      existing,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("detects duplicates with mixed whitespace and case", () => {
    const existing: RoleDefinition[] = [
      {
        id: "mixed-role",
        label: "  Expert Debugger  ",
        systemInstruction: "You are a role.",
        builtIn: false,
      },
    ];

    const result = validateCustomRole(
      { label: "expert debugger", systemInstruction: "Some instruction" },
      existing,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("allows truly different labels", () => {
    const existing: RoleDefinition[] = [
      {
        id: "existing",
        label: "  My Role  ",
        systemInstruction: "You are a role.",
        builtIn: false,
      },
    ];

    const result = validateCustomRole(
      { label: "Different Role", systemInstruction: "Some instruction" },
      existing,
    );

    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// 5. encoding.ts — utf8ToBase64 correctness
// =============================================================================
describe("utf8ToBase64 — correctness", () => {
  it("encodes simple ASCII correctly", () => {
    const result = utf8ToBase64("hello");
    // btoa("hello") = "aGVsbG8="
    expect(result).toBe("aGVsbG8=");
  });

  it("encodes empty string", () => {
    const result = utf8ToBase64("");
    expect(result).toBe("");
  });

  it("handles multi-byte UTF-8 characters (emoji)", () => {
    const result = utf8ToBase64("hello 🌍");
    // Verify round-trip: decode and compare
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(result), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe("hello 🌍");
  });

  it("handles CJK characters", () => {
    const input = "你好世界";
    const result = utf8ToBase64(input);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(result), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(input);
  });

  it("handles accented characters (Latin-extended)", () => {
    const input = "café résumé naïve";
    const result = utf8ToBase64(input);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(result), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(input);
  });

  it("handles moderately large strings efficiently", () => {
    // 10KB string — should complete fast (not O(n²))
    const input = "a".repeat(10_000);
    const start = performance.now();
    const result = utf8ToBase64(input);
    const elapsed = performance.now() - start;

    // Verify correctness
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(result), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(input);

    // Should complete well under 100ms (O(n) should be <5ms)
    expect(elapsed).toBeLessThan(100);
  });

  it("handles mixed ASCII and multi-byte characters", () => {
    const input = "Hello, 世界! 🎉 Ñoño café";
    const result = utf8ToBase64(input);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(result), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(input);
  });
});
