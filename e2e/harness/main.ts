/**
 * Minimal xterm.js test harness for Playwright WebKit composition tests.
 *
 * Applies the same composition fix as TerminalPool.ts but without Tauri/PTY.
 * All onData output is captured in window.__terminalBuffer for assertions.
 *
 * Architecture (matches TerminalPool.ts):
 *   - xterm's CompositionHelper handles ALL composition events natively
 *   - We do NOT intercept/stopPropagation on composition events
 *   - Only block the stale keypress WKWebView fires after compositionend
 *   - patch-package fixes _keyDownSeen ordering in xterm.js
 */
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

declare global {
  interface Window {
    __terminalBuffer: string[];
    __terminal: Terminal;
  }
}

const terminal = new Terminal({ cols: 80, rows: 24 });
const container = document.getElementById("terminal")!;
terminal.open(container);

window.__terminalBuffer = [];
window.__terminal = terminal;

// ── WKWebView dead key fix ──
//
// Two targeted fixes:
// 1. patch-package: Moves _keyDownSeen=true AFTER customKeyEventHandler check
// 2. Block stale keypress after compositionend

let recentCompositionEnd = false;

// Track compositionend so we can block the stale keypress that follows.
// Does NOT stop propagation — xterm's CompositionHelper sees all events.
container.addEventListener("compositionend", () => {
  recentCompositionEnd = true;
  setTimeout(() => { recentCompositionEnd = false; }, 50);
}, true);

terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
  // Block keypress right after compositionend (WKWebView fires stale
  // keypress for the dead key char, setting _keyPressHandled=true which
  // causes the NEXT character's _inputEvent to be skipped).
  if (event.type === "keypress" && recentCompositionEnd) {
    recentCompositionEnd = false;
    return false;
  }

  // Clear composition flag on first keydown after compositionend.
  if (event.type === "keydown" && recentCompositionEnd) {
    recentCompositionEnd = false;
  }

  // Let xterm handle everything else natively.
  return true;
});

terminal.onData((data) => {
  window.__terminalBuffer.push(data);
  terminal.write(data);
});
