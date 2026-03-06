import { useState, useEffect, useCallback } from "react";
import "../styles/components/BranchConflictDialog.css";

interface BranchConflictDialogProps {
  branchName: string;
  usedBySessionLabel: string;
  onCreateNewBranch: (newBranchName: string) => void;
  onSwitchToSession: () => void;
  onCancel: () => void;
}

/**
 * Modal dialog shown when a user tries to checkout a branch that is
 * already checked out in another session's worktree.
 *
 * Offers three options:
 *  1. Create a new branch based on the target branch
 *  2. Switch to the session that already has the branch
 *  3. Cancel
 */
export function BranchConflictDialog({
  branchName,
  usedBySessionLabel,
  onCreateNewBranch,
  onSwitchToSession,
  onCancel,
}: BranchConflictDialogProps) {
  const [newBranchName, setNewBranchName] = useState(`${branchName}-2`);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const handleCreate = useCallback(() => {
    const name = newBranchName.trim();
    if (!name) {
      setValidationError("Branch name cannot be empty");
      return;
    }
    if (/\s/.test(name)) {
      setValidationError("Branch name cannot contain spaces");
      return;
    }
    if (name === branchName) {
      setValidationError("New branch must have a different name");
      return;
    }
    setValidationError(null);
    onCreateNewBranch(name);
  }, [newBranchName, branchName, onCreateNewBranch]);

  return (
    <div className="branch-conflict-overlay" onClick={onCancel}>
      <div className="branch-conflict-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="branch-conflict-header">
          <span className="branch-conflict-icon">&#9888;</span>
          <span className="branch-conflict-title">Branch In Use</span>
          <button className="branch-conflict-close" onClick={onCancel}>&times;</button>
        </div>

        {/* Body */}
        <div className="branch-conflict-body">
          <p className="branch-conflict-message">
            Branch <strong className="branch-conflict-branch-name">{branchName}</strong> is
            already checked out by session{" "}
            <strong className="branch-conflict-session-name">{usedBySessionLabel}</strong>.
          </p>
          <p className="branch-conflict-hint">
            Git worktrees do not allow the same branch to be checked out in
            multiple worktrees. Choose an action below:
          </p>

          {/* Actions */}
          <div className="branch-conflict-actions">
            <button
              className="git-btn branch-conflict-btn-switch"
              onClick={onSwitchToSession}
            >
              Switch to &ldquo;{usedBySessionLabel}&rdquo;
            </button>

            {!showCreateInput ? (
              <button
                className="git-btn branch-conflict-btn-create"
                onClick={() => setShowCreateInput(true)}
              >
                Create New Branch from &ldquo;{branchName}&rdquo;
              </button>
            ) : (
              <div className="branch-conflict-create-row">
                <input
                  className="branch-conflict-create-input"
                  value={newBranchName}
                  onChange={(e) => {
                    setNewBranchName(e.target.value);
                    setValidationError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setShowCreateInput(false);
                    }
                  }}
                  placeholder="new-branch-name"
                  autoFocus
                />
                <button className="git-btn" onClick={handleCreate} style={{ flex: "none", padding: "4px 12px" }}>
                  Create
                </button>
              </div>
            )}

            {validationError && (
              <div className="git-error" style={{ margin: 0 }}>{validationError}</div>
            )}

            <button
              className="git-btn branch-conflict-btn-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
