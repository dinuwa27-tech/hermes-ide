# v0.6.12

## Fixed

- **Projects no longer show thousands of false changes** — Large JavaScript/TypeScript projects with `node_modules/`, `.turbo/`, or other gitignored directories were incorrectly counted as changes, sometimes showing 100k+ files and causing the IDE to freeze or crash. The change counter now correctly respects `.gitignore` rules.

- **IDE no longer crashes after deleting a branch worktree** — Previously, if a worktree directory was removed externally, the IDE could crash when loading the session. It now gracefully falls back to the project root and cleans up stale references automatically.

- **Branch worktree cleanup is more reliable** — Closing a session now fully cleans up worktree references in the underlying git repository, preventing stale locks that could block `git checkout` on the same branch.
