/**
 * WKWebView Composition — Comprehensive Behavioral Test Suite
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS:
 *
 * macOS WKWebView (used by Tauri) has a 10-year-old unfixed bug (WebKit
 * Bug #165004) where composition events fire in the WRONG ORDER:
 *
 *   Chrome:    keydown → compositionstart → input → compositionend
 *   WKWebView: compositionstart → input → keydown  ← REVERSED
 *
 * This causes two problems:
 * 1. xterm's _keyPress fires a stale keypress after compositionend,
 *    setting _keyPressHandled=true which skips the NEXT character.
 * 2. xterm's _keyDownSeen was set BEFORE the customKeyEventHandler check,
 *    blocking _inputEvent even when the handler returned false.
 *
 * Our fix has two parts:
 * 1. patch-package: Moves _keyDownSeen=true AFTER customKeyEventHandler
 *    check in xterm.js, so when our handler returns false, _keyDownSeen
 *    stays false and _inputEvent can process the input.
 * 2. Keypress blocking: After compositionend, block the stale keypress
 *    that WKWebView fires, preventing _keyPressHandled from being set.
 *
 * CRITICAL: xterm's CompositionHelper handles ALL composition events
 * natively. We do NOT intercept/stopPropagation on composition events.
 * This is what fixes the display corruption with combining dead keys
 * (ã, é, á, etc.).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * HOW THIS TESTS IT:
 *
 * We model the DOM event propagation:
 *
 *   Event fires on textarea →
 *     1. Container capture-phase listener (compositionend only — no stopProp)
 *     2. Textarea listeners (xterm's internals — sees ALL events)
 *
 * We model xterm.js's key internals:
 *   - _keyDown: customKeyEventHandler check → _keyDownSeen (PATCHED order)
 *   - _keyPress: customKeyEventHandler check → _keyPressHandled
 *   - _inputEvent: checks _keyDownSeen and _keyPressHandled
 *   - CompositionHelper: compositionstart/end → _isComposing → finalizeComposition
 *
 * The test verifies that ptySends contains EXACTLY the expected characters
 * with NO duplicates and NO missing characters.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── Minimal Event Propagation Model ─────────────────────────────────

interface SimEvent {
  type: string;
  stopped: boolean;
  data?: string | null;
  inputType?: string;
  isComposing?: boolean;
  key?: string;
  code?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  charCode?: number;
}

function makeEvent(type: string, props: Partial<SimEvent> = {}): SimEvent {
  return { type, stopped: false, ...props };
}

// ─── State ───────────────────────────────────────────────────────────

// Our fix state
let recentCompositionEnd: boolean;

// xterm.js internal state
let xtermIsComposing: boolean;
let xtermIsSendingComposition: boolean;
let xtermCompositionStart: number;
let xtermKeyDownSeen: boolean;
let xtermKeyPressHandled: boolean;
let textareaValue: string;
let ptySends: string[];
let pendingTimeouts: (() => void)[];

// ─── Our Fix: Container Capture Listener (compositionend only) ───────

function containerCompositionEndCapture(_e: SimEvent): void {
  // Does NOT stop propagation — xterm sees the event
  recentCompositionEnd = true;
  // Safety timeout (modeled by flushTimeouts clearing it)
}

// ─── Our Fix: attachCustomKeyEventHandler ────────────────────────────

function customKeyEventHandler(e: SimEvent): boolean {
  // Block keypress right after compositionend
  if (e.type === "keypress" && recentCompositionEnd) {
    recentCompositionEnd = false;
    return false;
  }

  // Clear composition flag on first keydown after compositionend
  if (e.type === "keydown" && recentCompositionEnd) {
    recentCompositionEnd = false;
  }

  // Let xterm handle everything else natively
  return true;
}

// ─── xterm.js Internal Model ─────────────────────────────────────────

function xtermKeydownHandler(e: SimEvent): void {
  // xterm's _keyDown: PATCHED — customKeyEventHandler check BEFORE _keyDownSeen
  xtermKeyPressHandled = false; // reset at start of _keyDown (not exactly but close enough)

  if (!customKeyEventHandler(e)) return;

  // PATCHED: _keyDownSeen set AFTER handler returns true
  xtermKeyDownSeen = true;

  // CompositionHelper.keydown():
  // 1. If composing + keyCode=229 → continue composing, return false
  // 2. If _isSendingComposition + non-229 non-modifier → immediate read, return true
  // 3. If not composing + keyCode=229 → _handleAnyTextareaChanges
  if (xtermIsComposing) {
    if (e.keyCode === 229) return;
  }

  // _isSendingComposition: compositionend scheduled a read, but a keydown
  // arrived first. Read the composition data IMMEDIATELY before the trailing
  // keystroke modifies the textarea.
  if (xtermIsSendingComposition && e.keyCode !== 229) {
    const data = textareaValue.substring(xtermCompositionStart);
    if (data.length > 0) {
      xtermOnData(data);
    }
    xtermCompositionStart = textareaValue.length;
    xtermIsSendingComposition = false;
  }

  if (e.keyCode === 229 && !xtermIsComposing) {
    // Not composing + keyCode=229 → _handleAnyTextareaChanges via setTimeout(0)
    const oldValue = textareaValue;
    pendingTimeouts.push(() => {
      const newValue = textareaValue;
      if (newValue.length > oldValue.length) {
        const diff = newValue.slice(oldValue.length);
        if (diff.length > 0) {
          xtermOnData(diff);
        }
      }
    });
    return;
  }

  // evaluateKeyboardEvent: handle special keys
  switch (e.key) {
    case "Enter": xtermOnData("\r"); return;
    case "Backspace": xtermOnData("\x7f"); return;
    case "Tab": xtermOnData("\t"); return;
    case "Escape": xtermOnData("\x1b"); return;
    case "ArrowUp": xtermOnData("\x1b[A"); return;
    case "ArrowDown": xtermOnData("\x1b[B"); return;
    case "ArrowLeft": xtermOnData("\x1b[D"); return;
    case "ArrowRight": xtermOnData("\x1b[C"); return;
  }

  // For printable keys, xterm handles via evaluateKeyboardEvent
  // which checks ev.key.length === 1 → result.key = ev.key
  if (e.key && e.key.length === 1) {
    xtermOnData(e.key);
  }
}

function xtermKeypressHandler(e: SimEvent): void {
  // xterm's _keyPress: customKeyEventHandler check first
  if (!customKeyEventHandler(e)) return;

  // If handler returned true, _keyPressHandled is set
  xtermKeyPressHandled = true;
}

function xtermInputHandler(e: SimEvent): void {
  // xterm's _inputEvent (line 1192) ONLY processes insertText:
  //   if (ev.data && ev.inputType === 'insertText' && (!ev.composed || !this._keyDownSeen))
  // Composition-related input types (insertCompositionText, deleteCompositionText,
  // insertFromComposition) are ignored — CompositionHelper handles those.
  if (e.inputType !== "insertText") return;

  if (xtermKeyPressHandled) return;

  if (e.data && !xtermKeyDownSeen) {
    xtermOnData(e.data);
  }

  // xterm clears textarea and resets flags in setTimeout(0)
  pendingTimeouts.push(() => {
    textareaValue = "";
    xtermKeyDownSeen = false;
    xtermKeyPressHandled = false;
  });
}

function xtermCompositionStartHandler(_e: SimEvent): void {
  xtermIsComposing = true;
  // Record textarea position at composition start
  xtermCompositionStart = textareaValue.length;
}

function xtermCompositionEndHandler(_e: SimEvent): void {
  xtermIsComposing = false;
  // CompositionHelper._finalizeComposition:
  //   - Sets _isSendingComposition = true
  //   - Schedules setTimeout(0) to read textarea
  // If a keydown arrives before the setTimeout, it triggers immediate read
  // (handled in xtermKeydownHandler via _isSendingComposition check)
  xtermIsSendingComposition = true;
  const capturedStart = xtermCompositionStart;
  pendingTimeouts.push(() => {
    // Only read if not already consumed by an immediate read
    if (xtermIsSendingComposition) {
      const value = textareaValue;
      if (value.length > capturedStart) {
        const data = value.substring(capturedStart);
        xtermOnData(data);
      }
      xtermCompositionStart = textareaValue.length;
      xtermIsSendingComposition = false;
    }
    textareaValue = "";
  });
}

/** terminal.onData — clean, no guards needed */
function xtermOnData(data: string): void {
  ptySends.push(data);
}

// ─── Event Dispatch (Models DOM Capture-Phase Propagation) ───────────

function dispatch(e: SimEvent): void {
  // Step 1: Container capture listeners (our code — ONLY compositionend)
  if (e.type === "compositionend") {
    containerCompositionEndCapture(e);
  }
  // Note: NO stopPropagation — event ALWAYS reaches xterm

  // Step 2: Event reaches xterm's textarea handlers
  switch (e.type) {
    case "keydown": xtermKeydownHandler(e); break;
    case "keypress": xtermKeypressHandler(e); break;
    case "input": xtermInputHandler(e); break;
    case "compositionstart": xtermCompositionStartHandler(e); break;
    case "compositionend": xtermCompositionEndHandler(e); break;
  }
}

/** Flush all pending setTimeout(0) callbacks */
function flushTimeouts(): void {
  const fns = [...pendingTimeouts];
  pendingTimeouts = [];
  for (const fn of fns) fn();
}

// ─── Event Simulation Helpers ────────────────────────────────────────

function fireKeydown(key: string, code: string, opts: {
  isComposing?: boolean; keyCode?: number;
  ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
} = {}): void {
  dispatch(makeEvent("keydown", {
    key, code,
    isComposing: opts.isComposing ?? false,
    keyCode: opts.keyCode ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
  }));
}

function fireKeypress(key: string, charCode: number): void {
  dispatch(makeEvent("keypress", { key, charCode }));
}

function fireInput(data: string | null, inputType: string, isComposing = false): void {
  // Simulate browser updating textarea value
  if (data && (inputType === "insertText" || inputType === "insertCompositionText" || inputType === "insertFromComposition")) {
    textareaValue += data;
  } else if (inputType === "deleteCompositionText" && textareaValue.length > 0) {
    textareaValue = textareaValue.slice(0, -1);
  }

  dispatch(makeEvent("input", { data, inputType, isComposing }));
}

function fireCompositionStart(data = ""): void {
  dispatch(makeEvent("compositionstart", { data }));
}

function fireCompositionUpdate(data: string): void {
  dispatch(makeEvent("compositionupdate", { data }));
}

function fireCompositionEnd(data: string): void {
  // The browser resolves the composition text in the textarea when
  // compositionend fires. Replace content from composition start with
  // the resolved data.
  textareaValue = textareaValue.substring(0, xtermCompositionStart) + data;
  dispatch(makeEvent("compositionend", { data }));
}

/** Type a regular character (keydown + input + flush) */
function typeChar(char: string, code: string): void {
  fireKeydown(char, code);
  fireInput(char, "insertText");
  flushTimeouts();
}

/**
 * Simulate a WKWebView dead key composition sequence (COMBINING).
 *
 * The dead key combines with the next character to produce an accented char.
 * Example: dead key ' + e → é
 *
 * WKWebView event order:
 *   1. compositionstart (data="")
 *   2. compositionupdate (data=pendingChar like "'" or "˜")
 *   3. input (data=pendingChar, insertCompositionText, isComposing=true)
 *   4. keydown (key="Dead", code=keyCode, isComposing=true, keyCode=229)
 *   5. input (data=null, deleteCompositionText, isComposing=true)
 *   6. input (data=resolvedChar, insertFromComposition, isComposing=true)
 *   7. compositionend (data=resolvedChar)
 *   8. keypress (STALE — WKWebView fires this after compositionend)
 *
 * xterm's CompositionHelper handles 1-7 natively.
 * Our fix blocks 8 (the stale keypress).
 */
function fireDeadKeyComposition(pendingChar: string, resolvedChar: string, deadKeyCode: string): void {
  fireCompositionStart("");
  fireCompositionUpdate(pendingChar);
  fireInput(pendingChar, "insertCompositionText", true);
  fireKeydown("Dead", deadKeyCode, { isComposing: true, keyCode: 229 });
  fireInput(null, "deleteCompositionText", true);
  fireInput(resolvedChar, "insertFromComposition", true);
  fireCompositionEnd(resolvedChar);
  // WKWebView fires a stale keypress after compositionend
  fireKeypress(pendingChar, pendingChar.charCodeAt(0));
}

/**
 * Simulate a WKWebView non-combining dead key composition.
 *
 * When a dead key doesn't combine with the next character (e.g., ' + t),
 * WKWebView fires compositionend with just the dead key char, then fires
 * the resolving keystroke's keydown + keypress + input AFTER compositionend.
 *
 * Event order:
 *   1. compositionstart (data="")
 *   2. compositionupdate (data=pendingChar like "'")
 *   3. input (data=pendingChar, insertCompositionText, isComposing=true)
 *   4. keydown (key="Dead", code=deadKeyCode, isComposing=true, keyCode=229)
 *   5. compositionend (data=resolvedChar)
 *   6. keypress (STALE — blocked by our fix)
 *   7. keydown (key=trailingChar) ← xterm handles natively
 *   8. input (data=trailingChar, insertText) ← xterm processes via _inputEvent
 *
 * With our patch, step 7's keydown goes through the handler (returns true),
 * sets _keyDownSeen=true, and evaluateKeyboardEvent processes the key.
 * Step 8's input may also fire. The char arrives exactly once.
 */
function fireDeadKeyNonCombining(
  pendingChar: string,
  deadKeyCode: string,
  trailingChar: string,
  resolvedChar?: string,
): void {
  const endChar = resolvedChar ?? pendingChar;
  fireCompositionStart("");
  fireCompositionUpdate(pendingChar);
  fireInput(pendingChar, "insertCompositionText", true);
  fireKeydown("Dead", deadKeyCode, { isComposing: true, keyCode: 229 });
  fireCompositionEnd(endChar);
  // WKWebView fires stale keypress after compositionend
  fireKeypress(pendingChar, pendingChar.charCodeAt(0));
  // Then the resolving keystroke fires normally
  fireKeydown(trailingChar, `Key${trailingChar.toUpperCase()}`);
  fireInput(trailingChar, "insertText");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("WKWebView composition behavioral tests (native composition + keypress blocking)", () => {
  beforeEach(() => {
    recentCompositionEnd = false;
    xtermIsComposing = false;
    xtermIsSendingComposition = false;
    xtermCompositionStart = 0;
    xtermKeyDownSeen = false;
    xtermKeyPressHandled = false;
    textareaValue = "";
    ptySends = [];
    pendingTimeouts = [];
  });

  // ── Dead Key: Apostrophe (Brazilian Portuguese) ────────────────────

  describe("dead key: apostrophe (Brazilian Portuguese keyboard)", () => {
    it("don't — apostrophe sent exactly once, no duplication", () => {
      typeChar("d", "KeyD");
      typeChar("o", "KeyO");
      typeChar("n", "KeyN");
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();
      typeChar("t", "KeyT");

      expect(ptySends).toEqual(["d", "o", "n", "'", "t"]);
    });

    it("it's — apostrophe between characters", () => {
      typeChar("i", "KeyI");
      typeChar("t", "KeyT");
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();
      typeChar("s", "KeyS");

      expect(ptySends).toEqual(["i", "t", "'", "s"]);
    });

    it("café — dead key ' + e produces é", () => {
      typeChar("c", "KeyC");
      typeChar("a", "KeyA");
      typeChar("f", "KeyF");
      fireDeadKeyComposition("'", "é", "Quote");
      flushTimeouts();

      expect(ptySends).toEqual(["c", "a", "f", "é"]);
    });

    it("naïve — dead key ¨ + i produces ï", () => {
      typeChar("n", "KeyN");
      typeChar("a", "KeyA");
      fireDeadKeyComposition("¨", "ï", "BracketLeft");
      flushTimeouts();
      typeChar("v", "KeyV");
      typeChar("e", "KeyE");

      expect(ptySends).toEqual(["n", "a", "ï", "v", "e"]);
    });
  });

  // ── Dead Key: Tilde ────────────────────────────────────────────────

  describe("dead key: tilde", () => {
    it("~ alone — sent exactly once", () => {
      fireDeadKeyComposition("˜", "~", "Backquote");
      flushTimeouts();

      expect(ptySends).toEqual(["~"]);
    });

    it("ã — tilde + a", () => {
      fireDeadKeyComposition("˜", "ã", "Backquote");
      flushTimeouts();

      expect(ptySends).toEqual(["ã"]);
    });

    it("ñ — tilde + n", () => {
      fireDeadKeyComposition("˜", "ñ", "Backquote");
      flushTimeouts();

      expect(ptySends).toEqual(["ñ"]);
    });

    it("são — s + tilde+a + o", () => {
      typeChar("s", "KeyS");
      fireDeadKeyComposition("˜", "ã", "Backquote");
      flushTimeouts();
      typeChar("o", "KeyO");

      expect(ptySends).toEqual(["s", "ã", "o"]);
    });
  });

  // ── Dead Key: Circumflex ──────────────────────────────────────────

  describe("dead key: circumflex", () => {
    it("ê — circumflex + e", () => {
      fireDeadKeyComposition("ˆ", "ê", "Digit6");
      flushTimeouts();

      expect(ptySends).toEqual(["ê"]);
    });

    it("â — circumflex + a", () => {
      fireDeadKeyComposition("ˆ", "â", "Digit6");
      flushTimeouts();

      expect(ptySends).toEqual(["â"]);
    });

    it("^ alone — circumflex with no vowel", () => {
      fireDeadKeyComposition("ˆ", "^", "Digit6");
      flushTimeouts();

      expect(ptySends).toEqual(["^"]);
    });
  });

  // ── Dead Key: Grave Accent ────────────────────────────────────────

  describe("dead key: grave accent", () => {
    it("è — grave + e", () => {
      fireDeadKeyComposition("`", "è", "Backquote");
      flushTimeouts();

      expect(ptySends).toEqual(["è"]);
    });

    it("à — grave + a", () => {
      fireDeadKeyComposition("`", "à", "Backquote");
      flushTimeouts();

      expect(ptySends).toEqual(["à"]);
    });

    it("` alone — grave with no vowel", () => {
      fireDeadKeyComposition("`", "`", "Backquote");
      flushTimeouts();

      expect(ptySends).toEqual(["`"]);
    });
  });

  // ── Dead Key: Umlaut ──────────────────────────────────────────────

  describe("dead key: umlaut", () => {
    it("ü — umlaut + u", () => {
      fireDeadKeyComposition("¨", "ü", "BracketLeft");
      flushTimeouts();

      expect(ptySends).toEqual(["ü"]);
    });

    it("ö — umlaut + o", () => {
      fireDeadKeyComposition("¨", "ö", "BracketLeft");
      flushTimeouts();

      expect(ptySends).toEqual(["ö"]);
    });
  });

  // ── Regular Typing (No Composition) ───────────────────────────────

  describe("regular typing without composition", () => {
    it("hello world — all ASCII characters arrive once", () => {
      const chars = "hello world".split("");
      for (const ch of chars) {
        typeChar(ch, ch === " " ? "Space" : `Key${ch.toUpperCase()}`);
      }
      flushTimeouts();

      expect(ptySends.join("")).toBe("hello world");
    });

    it("numbers and symbols", () => {
      typeChar("1", "Digit1");
      typeChar("+", "Equal");
      typeChar("2", "Digit2");
      typeChar("=", "Equal");
      typeChar("3", "Digit3");
      flushTimeouts();

      expect(ptySends).toEqual(["1", "+", "2", "=", "3"]);
    });

    it("Enter sends \\r", () => {
      typeChar("a", "KeyA");
      fireKeydown("Enter", "Enter");
      flushTimeouts();

      expect(ptySends).toEqual(["a", "\r"]);
    });

    it("Backspace sends \\x7f", () => {
      typeChar("a", "KeyA");
      fireKeydown("Backspace", "Backspace");
      flushTimeouts();

      expect(ptySends).toEqual(["a", "\x7f"]);
    });
  });

  // ── Post-Composition Characters ───────────────────────────────────

  describe("characters immediately after composition", () => {
    it("character typed immediately after dead key is not lost", () => {
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();

      typeChar("x", "KeyX");

      expect(ptySends).toEqual(["'", "x"]);
    });

    it("Enter after dead key composition works", () => {
      fireDeadKeyComposition("'", "é", "Quote");
      flushTimeouts();

      fireKeydown("Enter", "Enter");
      flushTimeouts();

      expect(ptySends).toEqual(["é", "\r"]);
    });

    it("Backspace after dead key composition works", () => {
      typeChar("a", "KeyA");
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();

      fireKeydown("Backspace", "Backspace");
      flushTimeouts();

      expect(ptySends).toEqual(["a", "'", "\x7f"]);
    });
  });

  // ── Consecutive Compositions ──────────────────────────────────────

  describe("consecutive compositions", () => {
    it("two apostrophes in a row", () => {
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();

      expect(ptySends).toEqual(["'", "'"]);
    });

    it("apostrophe then accented é", () => {
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();
      fireDeadKeyComposition("'", "é", "Quote");
      flushTimeouts();

      expect(ptySends).toEqual(["'", "é"]);
    });

    it("three different dead key sequences", () => {
      fireDeadKeyComposition("'", "é", "Quote");
      flushTimeouts();
      fireDeadKeyComposition("˜", "ã", "Backquote");
      flushTimeouts();
      fireDeadKeyComposition("`", "è", "Backquote");
      flushTimeouts();

      expect(ptySends).toEqual(["é", "ã", "è"]);
    });

    it("rapid compositions with characters between", () => {
      typeChar("a", "KeyA");
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();
      typeChar("b", "KeyB");
      fireDeadKeyComposition("˜", "~", "Backquote");
      flushTimeouts();
      typeChar("c", "KeyC");

      expect(ptySends).toEqual(["a", "'", "b", "~", "c"]);
    });
  });

  // ── Keypress Blocking (Core Fix) ──────────────────────────────────

  describe("keypress blocking after compositionend", () => {
    it("stale keypress after compositionend is blocked", () => {
      // The stale keypress is fired inside fireDeadKeyComposition.
      // If NOT blocked, it would set _keyPressHandled=true,
      // causing the NEXT character's _inputEvent to be skipped.
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();

      // This character MUST arrive — the stale keypress was blocked
      typeChar("t", "KeyT");

      expect(ptySends).toEqual(["'", "t"]);
    });

    it("keypress blocking flag is cleared on next keydown", () => {
      fireDeadKeyComposition("'", "é", "Quote");
      flushTimeouts();

      // The stale keypress set recentCompositionEnd=false already,
      // but even if it didn't, the next keydown would clear it.
      fireKeydown("Enter", "Enter");
      flushTimeouts();

      expect(ptySends).toEqual(["é", "\r"]);
    });

    it("no spurious keypress blocking on normal typing", () => {
      // recentCompositionEnd is false by default, so normal keypress
      // events are not blocked (they pass through to xterm).
      typeChar("a", "KeyA");
      typeChar("b", "KeyB");
      typeChar("c", "KeyC");

      expect(ptySends).toEqual(["a", "b", "c"]);
    });
  });

  // ── xterm Handles Composition Natively ─────────────────────────────

  describe("xterm CompositionHelper handles composition natively", () => {
    it("compositionstart sets xtermIsComposing", () => {
      expect(xtermIsComposing).toBe(false);

      fireCompositionStart("");

      // xterm DOES see compositionstart (no stopPropagation)
      expect(xtermIsComposing).toBe(true);
    });

    it("compositionend clears xtermIsComposing and reads textarea", () => {
      fireCompositionStart("");
      expect(xtermIsComposing).toBe(true);

      textareaValue = "é";
      fireCompositionEnd("é");

      expect(xtermIsComposing).toBe(false);
      // The resolved char is sent via setTimeout(0)
      flushTimeouts();
      expect(ptySends).toEqual(["é"]);
    });

    it("Dead keydown during composition is handled by CompositionHelper", () => {
      fireCompositionStart("");
      expect(xtermIsComposing).toBe(true);

      // Dead keydown with keyCode=229 during composition
      // CompositionHelper.keydown() returns false → continue composing
      const timeoutsBefore = pendingTimeouts.length;
      fireKeydown("Dead", "Quote", { isComposing: true, keyCode: 229 });

      // No new timeouts — CompositionHelper handled it by returning false
      expect(pendingTimeouts.length).toBe(timeoutsBefore);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("empty compositionend.data does not inject anything", () => {
      fireCompositionStart("");
      fireCompositionUpdate("'");
      fireInput("'", "insertCompositionText", true);
      // Composition cancelled — empty data
      textareaValue = "";
      fireCompositionEnd("");
      flushTimeouts();

      expect(ptySends).toEqual([]);
    });

    it("Ctrl-C is not affected by composition handling", () => {
      typeChar("a", "KeyA");
      fireKeydown("c", "KeyC", { ctrlKey: true });
      flushTimeouts();

      // Ctrl-C passes through the key handler (returns true)
      expect(ptySends[0]).toBe("a");
    });

    it("modifier keys pass through normally", () => {
      fireKeydown("Meta", "MetaLeft", { metaKey: true });
      fireKeydown("Alt", "AltLeft", { altKey: true });
      flushTimeouts();

      // Modifier keys don't produce onData output
      expect(ptySends).toEqual([]);
    });
  });

  // ── Non-Combining Dead Key (trailing char fires AFTER compositionend) ──

  describe("non-combining dead key: trailing char after compositionend", () => {
    it("don't — 't' after non-combining apostrophe is NOT lost", () => {
      typeChar("d", "KeyD");
      typeChar("o", "KeyO");
      typeChar("n", "KeyN");
      fireDeadKeyNonCombining("'", "Quote", "t");
      flushTimeouts();

      expect(ptySends).toEqual(["d", "o", "n", "'", "t"]);
    });

    it("it's — 's' after non-combining apostrophe", () => {
      typeChar("i", "KeyI");
      typeChar("t", "KeyT");
      fireDeadKeyNonCombining("'", "Quote", "s");
      flushTimeouts();

      expect(ptySends).toEqual(["i", "t", "'", "s"]);
    });

    it("circumflex + non-combining 's' → ^ then s", () => {
      fireDeadKeyNonCombining("ˆ", "Digit6", "s", "^");
      flushTimeouts();

      expect(ptySends).toEqual(["^", "s"]);
    });

    it("grave + non-combining 't' → ` then t", () => {
      fireDeadKeyNonCombining("`", "Backquote", "t");
      flushTimeouts();

      expect(ptySends).toEqual(["`", "t"]);
    });

    it("tilde + non-combining 'b' → ~ then b", () => {
      fireDeadKeyNonCombining("˜", "Backquote", "b", "~");
      flushTimeouts();

      expect(ptySends).toEqual(["~", "b"]);
    });

    it("café still works (combining case, no trailing input)", () => {
      typeChar("c", "KeyC");
      typeChar("a", "KeyA");
      typeChar("f", "KeyF");
      fireDeadKeyComposition("'", "é", "Quote");
      flushTimeouts();

      expect(ptySends).toEqual(["c", "a", "f", "é"]);
    });

    it("full sentence: don't panic → all characters present", () => {
      typeChar("d", "KeyD");
      typeChar("o", "KeyO");
      typeChar("n", "KeyN");
      fireDeadKeyNonCombining("'", "Quote", "t");
      flushTimeouts();
      typeChar(" ", "Space");
      for (const ch of "panic") {
        typeChar(ch, `Key${ch.toUpperCase()}`);
      }

      expect(ptySends.join("")).toBe("don't panic");
    });

    it("mixed combining and non-combining in same sentence", () => {
      typeChar("c", "KeyC");
      typeChar("a", "KeyA");
      typeChar("f", "KeyF");
      fireDeadKeyComposition("'", "é", "Quote");
      flushTimeouts();
      typeChar(" ", "Space");
      typeChar("d", "KeyD");
      typeChar("o", "KeyO");
      typeChar("n", "KeyN");
      fireDeadKeyNonCombining("'", "Quote", "t");
      flushTimeouts();

      expect(ptySends.join("")).toBe("café don't");
    });
  });

  // ── Mixed Scenarios (Real-World Typing Patterns) ──────────────────

  describe("real-world typing patterns", () => {
    it("full sentence: 'Olá, como você está?'", () => {
      typeChar("O", "KeyO");
      typeChar("l", "KeyL");
      fireDeadKeyComposition("'", "á", "Quote");
      flushTimeouts();
      typeChar(",", "Comma");
      typeChar(" ", "Space");
      for (const ch of "como") typeChar(ch, `Key${ch.toUpperCase()}`);
      typeChar(" ", "Space");
      for (const ch of "voc") typeChar(ch, `Key${ch.toUpperCase()}`);
      fireDeadKeyComposition("ˆ", "ê", "Digit6");
      flushTimeouts();
      typeChar(" ", "Space");
      for (const ch of "est") typeChar(ch, `Key${ch.toUpperCase()}`);
      fireDeadKeyComposition("'", "á", "Quote");
      flushTimeouts();
      typeChar("?", "Slash");

      expect(ptySends.join("")).toBe("Olá, como você está?");
    });

    it("shell command: echo 'it\\'s here'", () => {
      for (const ch of "echo") typeChar(ch, `Key${ch.toUpperCase()}`);
      typeChar(" ", "Space");
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();
      typeChar("i", "KeyI");
      typeChar("t", "KeyT");
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();
      typeChar("s", "KeyS");
      typeChar(" ", "Space");
      for (const ch of "here") typeChar(ch, `Key${ch.toUpperCase()}`);
      fireDeadKeyComposition("'", "'", "Quote");
      flushTimeouts();

      expect(ptySends.join("")).toBe("echo 'it's here'");
    });

    it("path with tilde: ~/documentação", () => {
      fireDeadKeyComposition("˜", "~", "Backquote");
      flushTimeouts();
      typeChar("/", "Slash");
      for (const ch of "documenta") typeChar(ch, `Key${ch.toUpperCase()}`);
      fireDeadKeyComposition("¸", "ç", "Semicolon");
      flushTimeouts();
      fireDeadKeyComposition("˜", "ã", "Backquote");
      flushTimeouts();
      typeChar("o", "KeyO");

      expect(ptySends.join("")).toBe("~/documentação");
    });

    it("git commit message: 'fix: não duplicar'", () => {
      for (const ch of "fix: ") {
        if (ch === " ") typeChar(" ", "Space");
        else if (ch === ":") typeChar(":", "Semicolon");
        else typeChar(ch, `Key${ch.toUpperCase()}`);
      }
      typeChar("n", "KeyN");
      fireDeadKeyComposition("˜", "ã", "Backquote");
      flushTimeouts();
      typeChar("o", "KeyO");
      typeChar(" ", "Space");
      for (const ch of "duplicar") typeChar(ch, `Key${ch.toUpperCase()}`);

      expect(ptySends.join("")).toBe("fix: não duplicar");
    });
  });

  // ── Stress Tests ──────────────────────────────────────────────────

  describe("stress: rapid alternation between normal and composition", () => {
    it("10 characters with every other being a dead key composition", () => {
      const expected: string[] = [];

      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          const ch = String.fromCharCode(97 + i);
          typeChar(ch, `Key${ch.toUpperCase()}`);
          expected.push(ch);
        } else {
          fireDeadKeyComposition("'", "'", "Quote");
          flushTimeouts();
          expected.push("'");
        }
      }

      expect(ptySends).toEqual(expected);
    });

    it("multiple compositions without flushing between them", () => {
      // When compositions happen back-to-back without flushing, xterm's
      // CompositionHelper accumulates the resolved characters in the textarea.
      // The first compositionend's setTimeout reads all accumulated text at once.
      // This is correct xterm behavior — onData receives the batched result.
      fireDeadKeyComposition("'", "á", "Quote");
      fireDeadKeyComposition("˜", "ã", "Backquote");
      fireDeadKeyComposition("`", "è", "Backquote");
      flushTimeouts();

      expect(ptySends.join("")).toBe("áãè");
    });
  });
});
