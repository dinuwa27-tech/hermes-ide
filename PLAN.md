# Git Worktree-Based Multi-Session Architecture

## Problem Statement

Currently, Hermes IDE's git integration is **global** — the Git panel sits at the same level as the session list, and all sessions pointing to the same repo share one working tree, one index, one branch. This means:

- Two sessions on the same repo **cannot work on different branches simultaneously**
- Staging/unstaging in one session **silently affects** the other
- There's no visual clarity about which session "owns" which git state
- The Git panel doesn't know which session it belongs to

## Solution: Git Worktrees as Session Isolation

Each session gets its own **git worktree** — an independent checkout of the same repo with its own branch, index, and working directory. The shared `.git` object store means no duplication of history.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  REPO: /home/user/my-project  (main worktree)          │
│  .git/                                                   │
│  .git/worktrees/session-abc/  ← metadata                │
│  .git/worktrees/session-def/  ← metadata                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Session 1 (main worktree)                               │
│  Path: /home/user/my-project                             │
│  Branch: main                                            │
│  Own index, own working tree                             │
│                                                          │
│  Session 2 (linked worktree)                             │
│  Path: /home/user/my-project/.hermes/worktrees/session-abc │
│  Branch: feature/auth                                    │
│  Own index, own working tree                             │
│                                                          │
│  Session 3 (linked worktree)                             │
│  Path: /home/user/my-project/.hermes/worktrees/session-def │
│  Branch: fix/bug-123                                     │
│  Own index, own working tree                             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Data Model Changes

### 1.1 New Database Table: `session_worktrees`

```sql
CREATE TABLE IF NOT EXISTS session_worktrees (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    realm_id TEXT NOT NULL,
    worktree_path TEXT NOT NULL,       -- Filesystem path of this worktree
    branch_name TEXT,                   -- Current branch (nullable for detached HEAD)
    is_main_worktree BOOLEAN NOT NULL DEFAULT 0,  -- TRUE if using the repo's main worktree
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, realm_id),
    UNIQUE(worktree_path)
);
CREATE INDEX IF NOT EXISTS idx_sw_session ON session_worktrees(session_id);
CREATE INDEX IF NOT EXISTS idx_sw_realm ON session_worktrees(realm_id);
```

### 1.2 Modified `session_realms` Table

Add a `worktree_id` column linking to the worktree:

```sql
ALTER TABLE session_realms ADD COLUMN worktree_id TEXT REFERENCES session_worktrees(id);
```

### 1.3 New Rust Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionWorktree {
    pub id: String,
    pub session_id: String,
    pub realm_id: String,
    pub worktree_path: String,
    pub branch_name: Option<String>,
    pub is_main_worktree: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub session_id: String,
    pub session_label: String,
    pub session_color: String,
    pub branch_name: Option<String>,
    pub worktree_path: String,
    pub is_main_worktree: bool,
}
```

---

## Phase 2: Backend Worktree Manager

### 2.1 New Module: `src-tauri/src/git/worktree.rs`

Core responsibilities:
- Create/remove worktrees tied to sessions
- Track which session owns which worktree
- Prevent branch conflicts (two sessions can't be on the same branch)
- Clean up worktrees when sessions are destroyed

### 2.2 Key Functions

```rust
/// Create a new worktree for a session.
/// If the session is the first to use this repo, it gets the main worktree.
/// Otherwise, a linked worktree is created under .hermes/worktrees/{session_id_short}/
pub fn create_session_worktree(
    repo_path: &str,
    session_id: &str,
    branch_name: Option<&str>,  // None = create from current HEAD
) -> Result<SessionWorktree, String>

/// Remove a session's worktree (on session close/destroy).
/// Main worktree is never removed — only unlinked from the session.
pub fn remove_session_worktree(
    repo_path: &str,
    session_id: &str,
) -> Result<(), String>

/// List all active worktrees for a repo, with their owning sessions.
pub fn list_repo_worktrees(
    repo_path: &str,
) -> Result<Vec<WorktreeInfo>, String>

/// Check if a branch is available (not checked out in another worktree).
pub fn is_branch_available(
    repo_path: &str,
    branch_name: &str,
    exclude_session_id: Option<&str>,
) -> Result<bool, String>

/// Switch a session's worktree to a different branch.
/// Validates branch is not in use by another session.
pub fn switch_worktree_branch(
    repo_path: &str,
    session_id: &str,
    new_branch: &str,
) -> Result<(), String>
```

### 2.3 Worktree Path Convention

```
{repo_path}/.hermes/worktrees/{session_id_first_8_chars}_{branch_name}/
```

Example:
```
/home/user/my-project/.hermes/worktrees/a1b2c3d4_feature-auth/
```

Add `.hermes/worktrees/` to `.gitignore` automatically on first worktree creation.

### 2.4 Session Lifecycle Integration

**On session create** (when attaching to a git repo):
1. Check if any other session is using the main worktree
2. If not → assign main worktree to this session
3. If yes → create a linked worktree (user picks branch or gets a new branch from HEAD)

**On session destroy**:
1. If session owns a linked worktree → `git worktree remove` (prune)
2. If session owns main worktree → unlink (main worktree stays, becomes available)
3. Clean up `session_worktrees` table

**On session reopen** (from recent sessions):
1. Re-create worktree if it was pruned
2. Or reclaim main worktree if available

---

## Phase 3: Refactor All Git Operations to Be Worktree-Aware

### 3.1 Core Change: `project_path` → `worktree_path`

Currently every git command takes `project_path` (the repo root). After refactoring, they must use the **session's worktree path**, which may differ from the repo root.

**New pattern for ALL 29 git IPC commands:**

```rust
// BEFORE: Uses repo root directly
#[tauri::command]
pub fn git_stage(project_path: String, paths: Vec<String>) -> Result<GitOperationResult, String>

// AFTER: Resolves worktree path from session context
#[tauri::command]
pub fn git_stage(
    state: State<'_, AppState>,
    session_id: String,
    realm_id: String,
    paths: Vec<String>,
) -> Result<GitOperationResult, String> {
    let worktree = get_session_worktree(&state, &session_id, &realm_id)?;
    // Use worktree.worktree_path instead of project_path
    let repo = Repository::open(&worktree.worktree_path)?;
    // ... rest of operation
}
```

### 3.2 Frontend API Changes

```typescript
// BEFORE
gitStage("/home/user/my-project", ["src/app.ts"])

// AFTER — session-scoped, backend resolves the correct worktree
gitStage(sessionId, realmId, ["src/app.ts"])
```

### 3.3 Git Status Changes

```rust
// BEFORE: git_status(session_id) → looks up all realms, uses realm.path
// AFTER:  git_status(session_id) → looks up all session_worktrees, uses worktree_path

pub fn git_status(session_id: &str) -> Result<GitSessionStatus, String> {
    let worktrees = db.get_session_worktrees(session_id)?;
    for wt in worktrees {
        let repo = Repository::open(&wt.worktree_path)?;
        // Compute status using this worktree's index and working dir
    }
}
```

### 3.4 Stash Isolation

Stashes are global in git (shared across worktrees). We need to **scope stashes by session**:

**Option A (Recommended): Stash tagging convention**
- When saving: prefix message with `[hermes:{session_id_short}]`
- When listing: filter by session prefix
- When applying/popping: validate it belongs to current session

**Option B: Branch-based stash tracking**
- Track stashes by recording (session_id, stash_index, stash_oid) in our DB
- More complex but avoids message convention

### 3.5 Branch Checkout Validation

Before ANY branch switch, check across all active worktrees:

```rust
fn validate_branch_checkout(repo_path: &str, branch: &str, session_id: &str) -> Result<(), String> {
    let worktrees = list_repo_worktrees(repo_path)?;
    for wt in worktrees {
        if wt.session_id != session_id && wt.branch_name.as_deref() == Some(branch) {
            return Err(format!(
                "Branch '{}' is already checked out in session '{}'. \
                 Git worktrees require each session to be on a different branch.",
                branch, wt.session_label
            ));
        }
    }
    Ok(())
}
```

---

## Phase 4: UI Redesign — Git Panel Per Session

### 4.1 Move Git Panel from Global to Per-Session

**BEFORE (current):**
```
┌─ Left Sidebar ──────────┐
│ [Sessions] [Git] [Files] │  ← Git is a global tab
│                           │
│  GitPanel (global)        │
│    └─ All projects        │
└───────────────────────────┘
```

**AFTER:**
```
┌─ Left Sidebar ──────────┐
│ [Sessions] [Files]       │  ← Git tab REMOVED from global
│                           │
│  Session List             │
└───────────────────────────┘

┌─ Per-Session Area ───────────────────┐
│ Terminal                              │
│                                       │
│ ┌─ Session Footer/Tab ──────────────┐│
│ │ [Terminal] [Git] [Output]         ││  ← Git is per-session
│ │                                    ││
│ │  GitPanel (scoped to THIS session) ││
│ │    Branch: feature/auth            ││
│ │    Staged: 2 files                 ││
│ │    Unstaged: 3 files               ││
│ └────────────────────────────────────┘│
└───────────────────────────────────────┘
```

### 4.2 Session Header: Branch & Worktree Indicator

Each session in the session list shows its git context:

```
┌─────────────────────────────────────┐
│ ● Session 1                    ×    │
│   my-project · main                 │  ← branch shown inline
│   [primary worktree]                │  ← worktree type badge
│                                     │
│ ● Session 2                    ×    │
│   my-project · feature/auth         │
│   [worktree]                        │
│                                     │
│ ● Session 3                    ×    │
│   my-project · fix/bug-123          │
│   [worktree]                        │
└─────────────────────────────────────┘
```

### 4.3 Branch Conflict Prevention UI

When a user tries to checkout a branch that's in use:

```
┌──────────────────────────────────────────────┐
│  ⚠ Branch "main" is in use                   │
│                                               │
│  This branch is checked out in Session 1.     │
│  Each session must be on a different branch.  │
│                                               │
│  Options:                                     │
│  [Create new branch from "main"]              │
│  [Switch to Session 1]                        │
│  [Cancel]                                     │
└──────────────────────────────────────────────┘
```

### 4.4 Repo Overview Panel (New)

A new top-level view showing all sessions and their worktrees for a repo:

```
┌─ Repo Overview: my-project ──────────────────┐
│                                               │
│  Branches in use:                             │
│                                               │
│  main ─────────── Session 1 (● active)        │
│  feature/auth ─── Session 2                   │
│  fix/bug-123 ──── Session 3                   │
│                                               │
│  Available branches:                          │
│  develop, release/v2, hotfix/login            │
│                                               │
│  [+ New Session on Branch...]                 │
└───────────────────────────────────────────────┘
```

### 4.5 Git Status in Session List (Always Visible)

Instead of hiding git info behind a panel toggle, show key git state directly in the session list item:

```
┌───────────────────────────────────────┐
│ ● Session 1               ↑2 ↓0   ×  │  ← ahead/behind always visible
│   my-project · main                   │
│   3 changes · 1 staged               │  ← file count summary
├───────────────────────────────────────┤
│ ● Session 2               ↑0 ↓3   ×  │
│   my-project · feature/auth           │
│   ⚠ 2 conflicts                      │  ← conflict warning prominent
└───────────────────────────────────────┘
```

### 4.6 Color-Coded Session Ownership

Every git element (diff views, merge banners, file explorers) carries the session's color as a subtle left border or accent, so the user always knows which session context they're in.

---

## Phase 5: Session Creation Flow Changes

### 5.1 New Session Wizard Step: Branch Selection

When creating a session that targets an existing git repo:

```
┌─ New Session ────────────────────────────────┐
│                                               │
│  Step 1: Select Project                       │
│  ✓ my-project (/home/user/my-project)        │
│                                               │
│  Step 2: Select Branch                        │  ← NEW STEP
│                                               │
│  ○ Use existing branch:                       │
│    [dropdown: develop, release/v2, ...]       │
│    (grayed out: main ← used by Session 1)     │
│                                               │
│  ○ Create new branch:                         │
│    Name: [feature/_______________]            │
│    From: [main ▼]                             │
│                                               │
│  ○ Stay on current branch (main worktree)     │
│    ⚠ Shares working tree with Session 1       │
│                                               │
│  Step 3: Configure                            │
│                                               │
│  [Create Session]                             │
└───────────────────────────────────────────────┘
```

### 5.2 Quick Session from Branch

Right-click a branch in any Git panel → "Open in New Session"

This creates:
1. New session
2. New worktree for that branch
3. Terminal pointed at the worktree path
4. Auto-attaches the realm

### 5.3 Shared Worktree Mode (Escape Hatch)

Sometimes users WANT two sessions on the same branch (e.g., one for terminal, one for AI). Allow this with a warning:

```
⚠ Shared Mode: Both sessions will share the same working tree.
   Changes in one session (staging, commits) will affect the other.
   [I understand, proceed]
```

In shared mode, both sessions use the same `worktree_path` (the main worktree). The `session_worktrees` table allows this via `is_main_worktree = true` for both.

---

## Phase 6: Terminal & File Explorer Integration

### 6.1 Terminal Working Directory

When a session has a linked worktree, its terminal starts in the **worktree path**, not the repo root:

```rust
// Session 2's terminal starts in:
// /home/user/my-project/.hermes/worktrees/a1b2c3d4_feature-auth/
// NOT /home/user/my-project/
```

This means `cd`, `git status`, `git diff` etc. all naturally work in the worktree context.

### 6.2 File Explorer Scope

The file explorer for a session shows the **worktree directory**, not the repo root. This ensures the user only sees the files relevant to their branch.

### 6.3 Working Directory Display

Status bar shows the worktree path with a clear indicator:

```
📂 my-project (worktree: feature/auth) — /home/user/my-project/.hermes/worktrees/a1b2c3d4_feature-auth
```

---

## Phase 7: Cleanup & Lifecycle Management

### 7.1 Session Close Behavior

When a session is closed:
1. **If linked worktree has uncommitted changes**: Prompt user
   - "Session 2 has uncommitted changes on branch `feature/auth`. What would you like to do?"
   - [Stash changes and close]
   - [Keep worktree (can reopen later)]
   - [Discard changes and remove worktree]
2. **If clean**: Remove worktree silently

### 7.2 Stale Worktree Cleanup

On app startup:
1. List all worktrees in `.hermes/worktrees/`
2. Cross-reference with `session_worktrees` table
3. Prune any orphaned worktrees (sessions that were force-killed)
4. Run `git worktree prune` on the main repo

### 7.3 Disk Space Management

Show worktree disk usage in settings:

```
Git Worktrees:
  my-project/
    main (Session 1) ─── 0 MB (main worktree, no extra space)
    feature/auth (Session 2) ─── 245 MB
    fix/bug-123 (Session 3) ─── 245 MB

  Total extra: 490 MB
  [Clean up closed session worktrees]
```

---

## Phase 8: New IPC Commands

### 8.1 Worktree Management Commands

```rust
// Create worktree for a session
git_create_worktree(session_id, realm_id, branch_name?, create_branch?) -> SessionWorktree

// Remove worktree for a session
git_remove_worktree(session_id, realm_id) -> GitOperationResult

// List all worktrees for a repo
git_list_worktrees(realm_id) -> Vec<WorktreeInfo>

// Check branch availability across all worktrees
git_check_branch_available(realm_id, branch_name) -> BranchAvailability

// Get worktree info for current session
git_session_worktree_info(session_id, realm_id) -> SessionWorktree
```

### 8.2 Modified Existing Commands (All 29)

Every existing git command signature changes from:
```rust
fn git_xxx(project_path: String, ...) -> Result<T, String>
```
to:
```rust
fn git_xxx(state: State<'_, AppState>, session_id: String, realm_id: String, ...) -> Result<T, String>
```

The backend resolves `worktree_path` internally.

---

## Phase 9: Event System Changes

### 9.1 New Events

```
worktree-created-{realm_id}        → Notify all sessions when a new worktree appears
worktree-removed-{realm_id}        → Notify when a worktree is removed
branch-locked-{realm_id}           → Notify when a branch becomes unavailable
branch-unlocked-{realm_id}         → Notify when a branch becomes available
```

### 9.2 Modified Events

```
session-updated                     → Now includes worktree_path and branch_name
git-status-changed-{session_id}    → NEW: per-session git status change notification
```

---

## Phase 10: Migration Strategy

### 10.1 Backward Compatibility

1. Existing sessions continue to use the main worktree (no disruption)
2. New sessions default to main worktree if no other session is using it
3. Worktree creation only happens when a second session wants the same repo
4. The `.hermes/worktrees/` directory is created lazily

### 10.2 Migration Steps

1. **DB Migration**: Add `session_worktrees` table
2. **Backfill**: For each existing `session_realms` entry, create a `session_worktrees` row with `is_main_worktree = true`
3. **API Migration**: Update all 29 git commands to accept session_id/realm_id
4. **Frontend Migration**: Update all git API calls to pass session context
5. **UI Migration**: Move GitPanel from global sidebar to per-session area

### 10.3 Implementation Order

```
Week 1: Data model + worktree manager (Phases 1-2)
Week 2: Refactor backend git commands (Phase 3)
Week 3: UI redesign - per-session git panel (Phase 4)
Week 4: Session creation flow + terminal integration (Phases 5-6)
Week 5: Lifecycle management + events (Phases 7-9)
Week 6: Migration, testing, polish (Phase 10)
```

---

## Key Constraints & Decisions

| Constraint | Decision |
|---|---|
| Two worktrees can't share a branch | Enforce at UI + backend level; show clear error |
| Stashes are global in git | Tag with session prefix `[hermes:{id}]` to scope |
| Main worktree can't be removed | Track ownership; reassign when session closes |
| Disk space for worktrees | Lazy creation; show usage in settings; auto-cleanup |
| git2-rs worktree API | Use `Repository::worktree_add()`, `find_worktree()`, `is_worktree()` |
| Worktree path convention | `.hermes/worktrees/{session_short_id}_{branch}/` |
| Shared mode escape hatch | Allow with explicit warning; both get `is_main_worktree = true` |

---

## Files to Create/Modify

### New Files
- `src-tauri/src/git/worktree.rs` — Worktree manager
- `src/components/WorktreeIndicator.tsx` — Session branch badge
- `src/components/BranchConflictDialog.tsx` — Branch-in-use dialog
- `src/components/RepoOverview.tsx` — Multi-session repo view
- `src/components/SessionGitPanel.tsx` — Per-session git panel (replaces global)

### Modified Files (Backend)
- `src-tauri/src/git/mod.rs` — All 29 commands refactored
- `src-tauri/src/db/mod.rs` — New table, queries
- `src-tauri/src/realm/mod.rs` — Worktree-aware attachment
- `src-tauri/src/pty/mod.rs` — Terminal starts in worktree path
- `src-tauri/src/lib.rs` — New IPC command registrations

### Modified Files (Frontend)
- `src/api/git.ts` — All API calls updated with session context
- `src/hooks/useGitStatus.ts` — Session-scoped polling
- `src/components/GitPanel.tsx` — Becomes per-session
- `src/components/GitProjectSection.tsx` — Uses worktree path
- `src/components/GitBranchSelector.tsx` — Shows branch availability
- `src/components/SessionList.tsx` — Shows branch + worktree info
- `src/components/SessionCreator.tsx` — Branch selection step
- `src/state/SessionContext.tsx` — Remove global git panel toggle; add per-session
- `src/types/git.ts` — New types for worktree
- `src/types/session.ts` — Add worktree info to session
