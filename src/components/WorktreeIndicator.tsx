import "../styles/components/WorktreeIndicator.css";

interface WorktreeIndicatorProps {
  sessionId: string;
  branchName: string | null;
  isMainWorktree: boolean;
  isActive: boolean;
}

/**
 * Small pill/badge showing worktree branch + type for a session list item.
 *
 * Main worktree:   [* main]        — default subtle styling
 * Linked worktree: [⎇ feature/x]  — accent-tinted to distinguish
 */
export function WorktreeIndicator({
  branchName,
  isMainWorktree,
  isActive,
}: WorktreeIndicatorProps) {
  if (!branchName) return null;

  const cls = [
    "worktree-indicator",
    isMainWorktree ? "worktree-indicator-main" : "worktree-indicator-linked",
    isActive ? "worktree-indicator-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={cls} title={isMainWorktree ? "Main worktree" : "Linked worktree"}>
      <span className="worktree-indicator-icon">
        {isMainWorktree ? "\u2731" : "\u2387"}
      </span>
      <span className="worktree-indicator-branch">{branchName}</span>
    </span>
  );
}
