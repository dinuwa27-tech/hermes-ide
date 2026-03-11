## Investigation: Root Cause Analysis

The macOS crash report shows:
- **Exception Type**: `EXC_CRASH (SIGABRT)`
- **Application Specific Information**: `*** multi-threaded process forked ***` / `crashed on child side of fork pre-exec`

This is a **macOS fork-safety violation**.

### Root Cause

When creating a new terminal session, `portable-pty` (v0.9) calls Rust's `std::process::Command::spawn()` with a `pre_exec` closure (to set up the PTY slave, call `setsid()`, `TIOCSCTTY`, etc.). On macOS, the presence of a `pre_exec` closure **forces** Rust's standard library to use `fork()` + `exec()` instead of the safer `posix_spawn()` syscall.

At the time `fork()` is called, the process already has **multiple threads running**:

1. **Tokio multi-threaded runtime** — created in `src-tauri/src/lib.rs:165` via `tokio::runtime::Runtime::new()` (uses `rt-multi-thread` feature). This spawns several worker threads before any Tauri command runs.
2. **Tauri's own threads** — the webview, IPC, and event loop threads.
3. **Other background threads** — if the user already has sessions open, each has a PTY reader thread, a silence-timer thread, and a child-reaper thread (`src-tauri/src/pty/commands.rs`).

### Why fork() crashes in a multi-threaded process on macOS

When `fork()` is called, the child process is a copy of the parent but with **only one thread** (the calling thread). All other threads' locks and mutexes are left in whatever state they were in — potentially held by now-nonexistent threads. If the child tries to acquire any of these locks before `exec()` (e.g., via `malloc`, signal handlers, `os_unfair_lock`), it deadlocks or aborts.

macOS is particularly aggressive about detecting this: the runtime inserts `os_unfair_lock` checks that abort the process with the "multi-threaded process forked" diagnostic.

### The specific code path

```
create_session (Tauri command, src-tauri/src/pty/commands.rs)
  → native_pty_system().openpty(...)         // line 135
  → pair.slave.spawn_command(cmd)            // line 203-206
    → std::process::Command::spawn()         // inside portable-pty unix.rs
      → fork() + pre_exec closure + exec()   // forced by pre_exec usage
        → CRASH on macOS (child side, pre-exec)
```

### Why it's intermittent

The crash depends on timing — it triggers when another thread holds a lock at the instant `fork()` is called. Creating a session with **multiple repos** likely triggers concurrent operations (git checks, DB writes, etc.) that increase the chance of lock contention during the fork window.

### Affected code

| File | Role |
|------|------|
| `src-tauri/src/lib.rs:165` | Creates multi-threaded Tokio runtime |
| `src-tauri/src/pty/commands.rs:135-206` | Opens PTY and spawns shell process |
| `src-tauri/Cargo.toml` | `portable-pty = "0.9"` + `tokio` with `rt-multi-thread` |

### Potential Solutions

**Option A: Use `posix_spawn` directly (Recommended)** — Replace the `portable-pty` spawn path on macOS with a custom implementation using `posix_spawn()` with appropriate attributes (`POSIX_SPAWN_SETSID`, `POSIX_SPAWN_CLOEXEC_DEFAULT`). This is a true kernel syscall on macOS — the child process is created atomically without the dangerous forked-but-not-exec'd intermediate state.

**Option B: Fork from a single-threaded helper process** — Spawn a lightweight helper early (before threads exist) that stays single-threaded. PTY creation requests are sent to it over a Unix socket. Safe because the helper has only one thread.

**Option C: Switch PTY library** — Consider alternatives like `pty-process` or a custom thin wrapper around `posix_spawn` + `openpty` that avoids `pre_exec` entirely.

### References
- [Apple Developer Forums: fork safety](https://developer.apple.com/forums/thread/737464)
- [node-pty #476: Big Sur hardened runtime vs fork](https://github.com/microsoft/node-pty/issues/476)
- [wezterm #2378: Crash on launch with SIGABRT](https://github.com/wezterm/wezterm/issues/2378)
- [portable-pty unix.rs spawn implementation](https://github.com/wez/wezterm/blob/main/pty/src/unix.rs)
