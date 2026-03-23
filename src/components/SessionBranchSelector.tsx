import "../styles/components/SessionBranchSelector.css";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { gitListBranchesForProject, listWorktrees, checkBranchAvailable, fetchRemoteBranches } from "../api/git";
import { validateBranchName } from "./GitBranchSelector";
import type { GitBranch, WorktreeInfo } from "../types/git";

interface SessionBranchSelectorProps {
  projectId: string;
  onBranchSelected: (branchName: string, createNew: boolean, fromRemote?: string) => void;
  onSkip: () => void;
}

type Tab = "existing" | "new";

interface BranchWithAvailability extends GitBranch {
  taken: boolean;
  takenBySession: string | null;
}

// ─── Pure helpers (exported for testing) ──────────────────────────────

/** Strip remote prefix (e.g. "origin/feature" -> "feature") */
export function stripRemotePrefix(name: string): string {
  const slashIndex = name.indexOf("/");
  return slashIndex >= 0 ? name.slice(slashIndex + 1) : name;
}

/** Extract remote prefix (e.g. "origin/feature" -> "origin/") */
export function getRemotePrefix(name: string): string {
  const slashIndex = name.indexOf("/");
  return slashIndex >= 0 ? name.slice(0, slashIndex + 1) : "";
}

/** Group augmented branches into local and remote sections */
export function groupAugmentedBranches(
  branches: BranchWithAvailability[],
): { local: BranchWithAvailability[]; remote: BranchWithAvailability[] } {
  const local: BranchWithAvailability[] = [];
  const remote: BranchWithAvailability[] = [];
  for (const b of branches) {
    if (b.is_remote) {
      remote.push(b);
    } else {
      local.push(b);
    }
  }
  return { local, remote };
}

export function SessionBranchSelector({ projectId, onBranchSelected, onSkip }: SessionBranchSelectorProps) {
  const [tab, setTab] = useState<Tab>("existing");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [fetchingRemotes, setFetchingRemotes] = useState(false);

  // New branch form
  const [newBranchName, setNewBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const newBranchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load branches and worktrees on mount
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [branchList, worktreeList] = await Promise.all([
        gitListBranchesForProject(projectId),
        listWorktrees(projectId),
      ]);
      setBranches(branchList);
      setWorktrees(worktreeList);

      // Default base branch to the current branch or first local branch
      const current = branchList.find((b) => b.is_current && !b.is_remote);
      const firstLocal = branchList.find((b) => !b.is_remote);
      setBaseBranch(current?.name || firstLocal?.name || "");

      // Fire a background fetch for fresh remote branches (non-blocking)
      setFetchingRemotes(true);
      fetchRemoteBranches(projectId)
        .then((remoteBranches) => {
          setBranches((prev) => {
            // Merge: keep all local branches, replace remote branches with fresh data
            const locals = prev.filter((b) => !b.is_remote);
            // Deduplicate remote branches by name
            const existingRemoteNames = new Set(remoteBranches.map((b) => b.name));
            const existingRemotesFromPrev = prev.filter(
              (b) => b.is_remote && !existingRemoteNames.has(b.name),
            );
            return [...locals, ...existingRemotesFromPrev, ...remoteBranches];
          });
        })
        .catch(() => {
          // Non-critical — remote branches from initial list are still available
        })
        .finally(() => setFetchingRemotes(false));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleRefreshRemotes = useCallback(() => {
    setFetchingRemotes(true);
    fetchRemoteBranches(projectId)
      .then((remoteBranches) => {
        setBranches((prev) => {
          const locals = prev.filter((b) => !b.is_remote);
          const existingRemoteNames = new Set(remoteBranches.map((b) => b.name));
          const existingRemotesFromPrev = prev.filter(
            (b) => b.is_remote && !existingRemoteNames.has(b.name),
          );
          return [...locals, ...existingRemotesFromPrev, ...remoteBranches];
        });
      })
      .catch(() => {
        // Non-critical
      })
      .finally(() => setFetchingRemotes(false));
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Focus search input when tab changes
  useEffect(() => {
    if (tab === "existing") {
      searchRef.current?.focus();
    } else {
      newBranchRef.current?.focus();
    }
  }, [tab]);

  // Build augmented branch list with availability info
  const takenBranches = useMemo(() => {
    const takenMap = new Map<string, string>();
    for (const wt of worktrees) {
      if (wt.branchName) {
        takenMap.set(wt.branchName, wt.sessionId);
      }
    }
    return takenMap;
  }, [worktrees]);

  const augmentedBranches: BranchWithAvailability[] = useMemo(() => {
    return branches
      .map((b) => ({
        ...b,
        taken: takenBranches.has(b.name),
        takenBySession: takenBranches.get(b.name) || null,
      }));
  }, [branches, takenBranches]);

  // Only local branches for the "New Branch" base selector
  const localAugmentedBranches = useMemo(
    () => augmentedBranches.filter((b) => !b.is_remote),
    [augmentedBranches],
  );

  const localBranchNames = useMemo(
    () => new Set(branches.filter((b) => !b.is_remote).map((b) => b.name)),
    [branches],
  );

  // Filter branches by search — across both local and remote
  const filteredBranches = useMemo(() => {
    const filtered = search.trim()
      ? augmentedBranches.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
      : augmentedBranches;
    return filtered;
  }, [augmentedBranches, search]);

  // Group filtered branches into local and remote
  const { local: filteredLocal, remote: filteredRemote } = useMemo(
    () => groupAugmentedBranches(filteredBranches),
    [filteredBranches],
  );

  // Flat list for keyboard navigation (local first, then remote)
  const flatFiltered = useMemo(
    () => [...filteredLocal, ...filteredRemote],
    [filteredLocal, filteredRemote],
  );

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll(".branch-selector-item");
      items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  // Validate new branch name
  useEffect(() => {
    if (!newBranchName.trim()) {
      setValidationError(null);
      return;
    }
    const nameError = validateBranchName(newBranchName);
    if (nameError) {
      setValidationError(nameError);
      return;
    }
    if (localBranchNames.has(newBranchName)) {
      setValidationError("A branch with this name already exists");
      return;
    }
    // Check availability via backend
    setCheckingAvailability(true);
    const timer = setTimeout(() => {
      checkBranchAvailable(projectId, newBranchName)
        .then((result) => {
          if (!result.available) {
            setValidationError(
              result.usedBySession
                ? `Branch is in use by another session`
                : "Branch is not available",
            );
          } else {
            setValidationError(null);
          }
        })
        .catch(() => {
          // Non-blocking — allow creation attempt
          setValidationError(null);
        })
        .finally(() => setCheckingAvailability(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [newBranchName, projectId, localBranchNames]);

  const handleSelectBranch = useCallback(
    (branchName: string) => {
      setSelectedBranch((prev) => (prev === branchName ? null : branchName));
    },
    [],
  );

  const handleConfirmExisting = useCallback(() => {
    if (!selectedBranch) return;
    const branch = augmentedBranches.find((b) => b.name === selectedBranch);
    if (branch?.is_remote) {
      // For remote branches: pass the local name (stripped prefix) and the full remote ref
      const localName = stripRemotePrefix(branch.name);
      onBranchSelected(localName, false, branch.name);
    } else {
      onBranchSelected(selectedBranch, false);
    }
  }, [selectedBranch, augmentedBranches, onBranchSelected]);

  const handleConfirmNew = useCallback(() => {
    if (!newBranchName.trim() || validationError || checkingAvailability) return;
    onBranchSelected(newBranchName.trim(), true);
  }, [newBranchName, validationError, checkingAvailability, onBranchSelected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (tab === "existing") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, flatFiltered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === "Enter" && highlightedIndex >= 0) {
        e.preventDefault();
        const branch = flatFiltered[highlightedIndex];
        if (branch && !branch.taken) {
          if (selectedBranch === branch.name) {
            handleConfirmExisting();
          } else {
            handleSelectBranch(branch.name);
          }
        }
      }
    } else if (tab === "new") {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmNew();
      }
    }
  };

  // Compute the flat index offset for remote branches
  const remoteIndexOffset = filteredLocal.length;

  // Check if a remote branch has a local tracking counterpart
  const hasLocalTracking = useCallback(
    (remoteBranch: BranchWithAvailability): boolean => {
      const localName = stripRemotePrefix(remoteBranch.name);
      return localBranchNames.has(localName);
    },
    [localBranchNames],
  );

  // Loading state
  if (loading) {
    return (
      <div className="branch-selector-body">
        <div className="session-creator-section-title">Select Branch</div>
        <div className="branch-selector-loading">Loading branches...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="branch-selector-body">
        <div className="session-creator-section-title">Select Branch</div>
        <div className="branch-selector-error">
          <span>Failed to load branches: {error}</span>
          <button className="branch-selector-error-retry" onClick={loadData} title="Retry loading branches">
            Retry
          </button>
        </div>
        <div className="session-creator-actions">
          <button className="session-creator-btn-secondary" onClick={onSkip}>
            Use current branch
          </button>
        </div>
      </div>
    );
  }

  // No branches (not a git repo or empty repo)
  if (localAugmentedBranches.length === 0 && filteredRemote.length === 0) {
    return (
      <div className="branch-selector-body">
        <div className="session-creator-section-title">Select Branch</div>
        <div className="branch-selector-empty">
          No local branches found. This project may not be a git repository,
          or the repository has no commits yet.
        </div>
        <div className="session-creator-actions">
          <button className="session-creator-btn-secondary" onClick={onSkip}>
            Use current branch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="branch-selector-body" onKeyDown={handleKeyDown}>
      <div className="session-creator-section-title">Select Branch</div>

      {/* Tab switcher */}
      <div className="branch-selector-tabs">
        <button
          className={`branch-selector-tab ${tab === "existing" ? "active" : ""}`}
          onClick={() => setTab("existing")}
        >
          Existing Branch
        </button>
        <button
          className={`branch-selector-tab ${tab === "new" ? "active" : ""}`}
          onClick={() => setTab("new")}
        >
          New Branch
        </button>
      </div>

      {/* Existing branch tab */}
      {tab === "existing" && (
        <>
          <input
            ref={searchRef}
            className="command-palette-input"
            placeholder="Filter branches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <div className="branch-selector-list" ref={listRef}>
            {flatFiltered.length === 0 && (
              <div className="branch-selector-empty">
                No branches matching &ldquo;{search}&rdquo;
              </div>
            )}

            {/* Local branches section */}
            {filteredLocal.length > 0 && (
              <>
                <div className="branch-selector-group-header">LOCAL BRANCHES</div>
                {filteredLocal.map((branch, idx) => (
                  <div
                    key={branch.name}
                    className={[
                      "branch-selector-item",
                      branch.taken ? "branch-selector-item-taken" : "",
                      selectedBranch === branch.name ? "branch-selector-item-selected" : "",
                      highlightedIndex === idx ? "branch-selector-item-highlighted" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => !branch.taken && handleSelectBranch(branch.name)}
                  >
                    <span className="branch-selector-item-name">{branch.name}</span>
                    {branch.is_current && (
                      <span className="branch-selector-item-current">current</span>
                    )}
                    {branch.taken && (
                      <span className="branch-selector-item-taken-label">
                        In use
                      </span>
                    )}
                    {!branch.taken && branch.last_commit_summary && (
                      <span className="branch-selector-item-summary">
                        {branch.last_commit_summary}
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Remote branches section */}
            {filteredRemote.length > 0 && (
              <>
                <div className="branch-selector-group-header">
                  <span>REMOTE BRANCHES</span>
                  <button
                    className="branch-selector-refresh-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefreshRemotes();
                    }}
                    disabled={fetchingRemotes}
                    title="Refresh remote branches"
                  >
                    <span className={fetchingRemotes ? "branch-selector-refresh-spinning" : ""}>
                      &#x21bb;
                    </span>
                  </button>
                </div>
                {filteredRemote.map((branch, idx) => (
                  <div
                    key={branch.name}
                    className={[
                      "branch-selector-item",
                      "branch-selector-item-remote",
                      branch.taken ? "branch-selector-item-taken" : "",
                      selectedBranch === branch.name ? "branch-selector-item-selected" : "",
                      highlightedIndex === remoteIndexOffset + idx ? "branch-selector-item-highlighted" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => !branch.taken && handleSelectBranch(branch.name)}
                  >
                    <span className="branch-selector-item-name">
                      <span className="branch-selector-remote-prefix">{getRemotePrefix(branch.name)}</span>
                      {stripRemotePrefix(branch.name)}
                    </span>
                    {hasLocalTracking(branch) && (
                      <span className="branch-selector-tracking-badge">tracking</span>
                    )}
                    {branch.taken && (
                      <span className="branch-selector-item-taken-label">
                        In use
                      </span>
                    )}
                    {!branch.taken && branch.last_commit_summary && (
                      <span className="branch-selector-item-summary">
                        {branch.last_commit_summary}
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="session-creator-hints">
            <span><kbd>&uarr;&darr;</kbd> navigate</span>
            <span><kbd>Enter</kbd> select</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </>
      )}

      {/* New branch tab */}
      {tab === "new" && (
        <div className="branch-selector-new-form">
          <div className="branch-selector-field">
            <label className="branch-selector-field-label">Branch Name</label>
            <input
              ref={newBranchRef}
              className={`branch-selector-field-input ${validationError ? "invalid" : ""}`}
              placeholder="feature/my-branch"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {validationError && (
              <span className="branch-selector-validation-error">{validationError}</span>
            )}
          </div>
          <div className="branch-selector-field">
            <label className="branch-selector-field-label">Based On</label>
            <select
              className="branch-selector-field-select"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
            >
              {localAugmentedBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}{b.is_current ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Skip warning */}
      <div className="branch-selector-skip-warning">
        <span className="branch-selector-skip-warning-icon">!</span>
        <span>
          Using the same branch as another session means both sessions share
          the same files. Changes in one session will immediately appear in
          the other.
        </span>
      </div>

      {/* Actions */}
      <div className="session-creator-actions">
        <button className="session-creator-btn-secondary" onClick={onSkip}>
          Use current branch
        </button>
        {tab === "existing" ? (
          <button
            className="session-creator-btn-primary"
            onClick={handleConfirmExisting}
            disabled={!selectedBranch}
          >
            Use Branch
          </button>
        ) : (
          <button
            className="session-creator-btn-primary"
            onClick={handleConfirmNew}
            disabled={!newBranchName.trim() || !!validationError || checkingAvailability}
          >
            {checkingAvailability ? "Checking..." : "Create & Use Branch"}
          </button>
        )}
      </div>
    </div>
  );
}
