## New
- Work on separate branches across multiple projects — each session can check out its own isolated copy without affecting other sessions
- Worktree management panel to view, search, and clean up all active worktrees across sessions
- Safety dialog when closing a session with uncommitted changes — choose to stash, discard, or cancel
- Branch mismatch warning when you navigate into another session's working directory
- Automatic cleanup of leftover worktrees from crashed or orphaned sessions

## Improved
- Session creation flow redesigned — choose Shell or AI first, then pick folders. Shell sessions use single-folder selection since a shell has one working directory. AI sessions support multiple folders for cross-project context
- Sessions with multiple projects now show all branches in the sidebar and status bar, not just the first
- Status bar shows per-project branch breakdown on hover for multi-project sessions
- Sessions that share a branch with another session now show a clear warning on creation

## Fixed
- Creating a session with an already checked-out branch no longer silently falls back to the wrong branch
- Stash failures during session close are now surfaced instead of silently losing changes
