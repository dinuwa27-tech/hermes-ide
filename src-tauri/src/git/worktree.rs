use git2::{BranchType, Repository};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// ─── Constants ──────────────────────────────────────────────────────

/// The directory within a repo where Hermes stores linked worktrees
const HERMES_WORKTREE_DIR: &str = ".hermes/worktrees";

// ─── Data Models ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub session_id: String,
    pub branch_name: Option<String>,
    pub worktree_path: String,
    pub is_main_worktree: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeCreateResult {
    pub worktree_path: String,
    pub branch_name: String,
    pub is_main_worktree: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchAvailability {
    pub available: bool,
    pub used_by_session: Option<String>,
    pub branch_name: String,
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Sanitize a branch name for use in filesystem paths.
/// Replaces `/` with `-` and removes characters that are problematic in paths.
fn sanitize_branch_name(branch_name: &str) -> String {
    branch_name
        .replace('/', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect()
}

/// Build a worktree name from session_id and branch_name.
/// Format: `{first_8_of_session_id}_{sanitized_branch}`
fn worktree_name(session_id: &str, branch_name: &str) -> String {
    let prefix: String = session_id.chars().take(8).collect();
    let sanitized = sanitize_branch_name(branch_name);
    format!("{}_{}", prefix, sanitized)
}

// ─── Public API ─────────────────────────────────────────────────────

/// Ensure that `.hermes/` is listed in the repo's `.gitignore` so that
/// worktree directories (and any other Hermes metadata) are never tracked.
///
/// Creates `.gitignore` if it does not already exist.
pub fn ensure_hermes_gitignore(repo_path: &str) -> Result<(), String> {
    let gitignore_path = Path::new(repo_path).join(".gitignore");

    if gitignore_path.exists() {
        let content = fs::read_to_string(&gitignore_path)
            .map_err(|e| format!("Failed to read .gitignore: {}", e))?;

        // Check whether `.hermes/` (or `.hermes`) is already ignored
        let already_ignored = content
            .lines()
            .any(|line| {
                let trimmed = line.trim();
                trimmed == ".hermes/" || trimmed == ".hermes"
            });

        if already_ignored {
            return Ok(());
        }

        // Append the entry, ensuring we start on a new line
        let to_append = if content.ends_with('\n') || content.is_empty() {
            ".hermes/\n".to_string()
        } else {
            "\n.hermes/\n".to_string()
        };

        fs::write(&gitignore_path, format!("{}{}", content, to_append))
            .map_err(|e| format!("Failed to update .gitignore: {}", e))?;
    } else {
        fs::write(&gitignore_path, ".hermes/\n")
            .map_err(|e| format!("Failed to create .gitignore: {}", e))?;
    }

    Ok(())
}

/// Returns the base directory for Hermes worktrees within a repo.
/// Creates the directory tree if it does not already exist.
pub fn worktree_dir(repo_path: &str) -> PathBuf {
    let dir = Path::new(repo_path).join(HERMES_WORKTREE_DIR);
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

/// Compute the filesystem path for a session's worktree.
///
/// Format: `{repo_path}/.hermes/worktrees/{session_prefix}_{branch}/`
pub fn worktree_path_for_session(repo_path: &str, session_id: &str, branch_name: &str) -> PathBuf {
    let base = worktree_dir(repo_path);
    base.join(worktree_name(session_id, branch_name))
}

/// Create a new git worktree for a session.
///
/// If `create_branch` is true, a new branch is created from HEAD before
/// adding the worktree. If false, the branch must already exist.
///
/// Uses `git worktree add` via the CLI because git2-rs does not expose a
/// reliable worktree-creation API.
pub fn create_worktree(
    repo_path: &str,
    session_id: &str,
    branch_name: &str,
    create_branch: bool,
) -> Result<WorktreeCreateResult, String> {
    // Validate that we can open the repository
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repository at '{}': {}", repo_path, e))?;

    // Make sure .hermes/ is git-ignored
    ensure_hermes_gitignore(repo_path)?;

    let wt_path = worktree_path_for_session(repo_path, session_id, branch_name);
    let wt_path_str = wt_path
        .to_str()
        .ok_or_else(|| "Worktree path contains invalid UTF-8".to_string())?;

    // If the worktree directory already exists, return it directly
    if wt_path.exists() {
        return Ok(WorktreeCreateResult {
            worktree_path: wt_path_str.to_string(),
            branch_name: branch_name.to_string(),
            is_main_worktree: false,
        });
    }

    if create_branch {
        // Ensure the branch does not already exist before creating it
        if repo.find_branch(branch_name, BranchType::Local).is_err() {
            let head = repo
                .head()
                .map_err(|e| format!("Failed to get HEAD: {}", e))?;
            let commit = head
                .peel_to_commit()
                .map_err(|e| format!("Failed to resolve HEAD commit: {}", e))?;
            repo.branch(branch_name, &commit, false)
                .map_err(|e| format!("Failed to create branch '{}': {}", branch_name, e))?;
        }
    }

    // Build the `git worktree add` command
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path);

    if create_branch {
        // Branch already created above — just check it out in the new worktree
        cmd.args(["worktree", "add", wt_path_str, branch_name]);
    } else {
        cmd.args(["worktree", "add", wt_path_str, branch_name]);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run 'git worktree add': {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree add failed: {}", stderr.trim()));
    }

    Ok(WorktreeCreateResult {
        worktree_path: wt_path_str.to_string(),
        branch_name: branch_name.to_string(),
        is_main_worktree: false,
    })
}

/// Remove a worktree for a session.
///
/// Uses `git worktree remove --force` followed by `git worktree prune`.
/// Also cleans up the directory if it still lingers after removal.
pub fn remove_worktree(
    repo_path: &str,
    _session_id: &str,
    worktree_path: &str,
) -> Result<(), String> {
    // Step 1: git worktree remove --force <path>
    let remove_output = Command::new("git")
        .current_dir(repo_path)
        .args(["worktree", "remove", "--force", worktree_path])
        .output()
        .map_err(|e| format!("Failed to run 'git worktree remove': {}", e))?;

    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr);
        // Non-fatal: the directory may already be gone; prune will tidy up
        log::warn!("git worktree remove warning: {}", stderr.trim());
    }

    // Step 2: git worktree prune
    let prune_output = Command::new("git")
        .current_dir(repo_path)
        .args(["worktree", "prune"])
        .output()
        .map_err(|e| format!("Failed to run 'git worktree prune': {}", e))?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr);
        log::warn!("git worktree prune warning: {}", stderr.trim());
    }

    // Step 3: Clean up the directory if it still exists
    let wt = Path::new(worktree_path);
    if wt.exists() {
        fs::remove_dir_all(wt)
            .map_err(|e| format!("Failed to remove worktree directory '{}': {}", worktree_path, e))?;
    }

    Ok(())
}

/// List the names of all linked worktrees in the repository.
///
/// Uses git2's `Repository::worktrees()` which returns the names of linked
/// worktrees (not the main worktree).
pub fn list_worktrees(repo_path: &str) -> Result<Vec<String>, String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repository at '{}': {}", repo_path, e))?;

    let worktrees = repo
        .worktrees()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    let names: Vec<String> = worktrees
        .iter()
        .filter_map(|name| name.map(|n| n.to_string()))
        .collect();

    Ok(names)
}

/// Check whether a branch is available (not checked out by any worktree).
///
/// If `exclude_worktree_path` is provided, that worktree is ignored during
/// the check (useful when the caller is the worktree that already has the
/// branch checked out and wants to know if anyone *else* does).
pub fn is_branch_available(
    repo_path: &str,
    branch_name: &str,
    exclude_worktree_path: Option<&str>,
) -> Result<bool, String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repository at '{}': {}", repo_path, e))?;

    // Check the main worktree's HEAD
    let main_path = repo
        .workdir()
        .map(|p| p.to_string_lossy().to_string());

    let should_skip_main = match (&main_path, exclude_worktree_path) {
        (Some(main), Some(exclude)) => {
            let main_canon = fs::canonicalize(main).ok();
            let excl_canon = fs::canonicalize(exclude).ok();
            main_canon.is_some() && main_canon == excl_canon
        }
        _ => false,
    };

    if !should_skip_main {
        if let Ok(Some(main_branch)) = get_worktree_branch(repo_path) {
            if main_branch == branch_name {
                return Ok(false);
            }
        }
    }

    // Check each linked worktree
    let worktree_names = repo
        .worktrees()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    for wt_name in worktree_names.iter().flatten() {
        let wt = repo
            .find_worktree(wt_name)
            .map_err(|e| format!("Failed to find worktree '{}': {}", wt_name, e))?;

        let wt_path_buf = wt.path().to_path_buf();
        let wt_path_str = wt_path_buf.to_string_lossy().to_string();

        // Skip the excluded worktree
        if let Some(exclude) = exclude_worktree_path {
            let wt_canon = fs::canonicalize(&wt_path_buf).ok();
            let excl_canon = fs::canonicalize(exclude).ok();
            if wt_canon.is_some() && wt_canon == excl_canon {
                continue;
            }
        }

        // Open the worktree as a Repository and check its HEAD
        if let Ok(Some(branch)) = get_worktree_branch(&wt_path_str) {
            if branch == branch_name {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

/// Get the branch name that is checked out in a worktree (or the main repo).
///
/// Returns `Ok(None)` if HEAD is detached (not pointing at a branch).
pub fn get_worktree_branch(worktree_path: &str) -> Result<Option<String>, String> {
    let repo = Repository::open(worktree_path)
        .map_err(|e| format!("Failed to open repository at '{}': {}", worktree_path, e))?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(e) => {
            // Unborn HEAD (empty repo) or other issue — treat as no branch
            log::debug!("Could not read HEAD at '{}': {}", worktree_path, e);
            return Ok(None);
        }
    };

    if !head.is_branch() {
        return Ok(None);
    }

    // head.shorthand() gives the branch name without `refs/heads/`
    Ok(head.shorthand().map(|s| s.to_string()))
}

/// Prune stale worktree bookkeeping entries and return how many were cleaned.
///
/// A worktree is "stale" when its directory has been deleted but git still
/// has metadata for it. `git worktree prune` removes those entries.
pub fn cleanup_stale_worktrees(repo_path: &str) -> Result<u32, String> {
    // Count worktrees before pruning
    let before = list_worktrees(repo_path)?.len() as u32;

    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["worktree", "prune", "--verbose"])
        .output()
        .map_err(|e| format!("Failed to run 'git worktree prune': {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree prune failed: {}", stderr.trim()));
    }

    // Count worktrees after pruning
    let after = list_worktrees(repo_path)?.len() as u32;

    let pruned = if before > after { before - after } else { 0 };

    Ok(pruned)
}
