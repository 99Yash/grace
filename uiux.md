Input & cursor (compose / search)

1. ✅ P0 — Cursor is static ▌, only shows on last line of body (apps/tui/src/index.tsx:503-505). Opencode doesn't implement cursor blinking at all — it uses
   opentui's native TextareaRenderable with cursorColor bound to theme (opencode/prompt/index.tsx:148). Opentui also exposes cursorStyle = { style: "line",
   blinking: true } where the terminal handles the blink via ANSI — zero JS interval cost.
2. ✅ P0 — Custom text input with manual cursor position math; wraps badly (:377-379, 484-509). Replace with opentui's native textarea / input. We'd delete
   ~100 lines and get selection + wrapping for free.
3. ✅ P1 — No central textarea keybinding registry. Opencode has ~40 actions (word-jump, delete-word, undo/redo) in textarea-keybindings.ts, compiled to
   KeyBinding[] via a memo. Port this file nearly verbatim. (Inherited via opentui's built-in defaultTextareaKeybindings — word-jump, delete-word, undo/redo, select-all, etc. all work now.)
4. P1 — Tab in body means "next field"; can't indent (:924-925). Fix with the registry above.
5. ✅ P2 — No paste normalization (CRLF leaks in). Opencode normalizes in onPaste. (opentui's InputRenderable.handlePaste and TextareaRenderable.handlePaste strip ANSI; Input also strips newlines.)

Loading & async states

6. ✅ P0 — Compose send freezes UI with no visible state (:918-920). Add opencode's deferred-spinner pattern: 500ms before showing, 3s minimum hold
   (opencode/startup-loading.tsx). Prevents flash on fast sends, feels intentional on slow ones.
7. ✅ P0 — w3mDump() is awaited inside the keyboard handler — whole TUI freezes 500ms+ (:119-127, 1036). Move off the input path; show spinner; cache
   rendered bodies. (Fire-and-forget with w3mBusy signal + in-reader spinner. Cache still TODO.)
8. ✅ P1 — Search SSE failure never surfaces (:752-756). Needs error state + retry. Opencode's toast pattern (ui/toast.tsx) with setTimeout(...).unref() is
   30 lines. (Transport and server-sent errors both flash a toast and show in the status line. Retry TODO.)
9. ✅ P1 — Body pane goes blank between messages (:786-797). Keep old body + dim it until new one loads.
10. ✅ P2 — Spinner component missing entirely. Copy opencode's braille-frame spinner with animations_enabled kv flag (spinner.tsx). (Added `<Spinner>` with braille frames; no kv flag — always on.)

Perf hotspots

11. P0 — Mail list is not virtualized. ScrollBox renders every child. At >500 mails this stutters. Opentui ships primitives but no auto-virtualizer — we
    manually window ~30 rows around viewport. Biggest single perf win.
12. ✅ P0 — Compose body lines() memo recomputes on every keystroke (:484, 497-509). Switch to native textarea (item #2) — obsoletes this.
13. P1 — <For each={props.hits}> has no key; full redraw on each SSE tick (:399). Add stable key.
14. P1 — Mutations fire per-keystroke with no debounce (:833-851). Rapid e e e = 3 POSTs. Use opencode's createDebouncedSignal (160ms).
15. P2 — Not using requestLive()/dropLive() — we're likely triggering full renders per keystroke. Enter live mode during scroll/type, drop when idle.
16. P2 — MessageRow color fns recompute every render (:142-170). Memoize.

Focus & keybindings

17. P1 — No focus save/restore across overlays. Opencode captures the focused renderable on dialog open, restores with 1ms defer on close  
    (ui/dialog.tsx:93-127). Cures lost focus after compose/search closes.
18. P1 — No ? help overlay — keybindings scattered, bottom bar has 3 variants (:1269-1287). Opencode has config-driven keybind registry  
    (context/keybind.tsx) that doubles as a help source.
19. P1 — Shift+Tab in compose jumps to body, not reverse-cycle (:616-621).
20. P2 — Two bindings for send (Ctrl+S, Ctrl+Enter); pick one.
21. P2 — j/k don't work while reader is open (:952). Add reader-scoped list nav.

Visual polish

22. ✅ P1 — Debug stats sel= top= view= ref= shown to users (:1285). Gate on DEBUG env. (Now gated on `GRACE_DEBUG`.)
23. ✅ P1 — Reader doesn't close when you archive the message you're reading (:840-842). (Capture `isActiveReader` BEFORE patchPending, else filtering the removed row out of visibleMessages() shifts currentMsg() to a neighbour and the compare misses.)
24. P1 — Optimistic mutation failures scramble selection (:839-851). Keep selection on next-or-prev row.
25. P2 — No draft auto-save — typed compose lost on crash (:583-597). Debounced write to disk; opencode's debounced-signal fits.
26. P2 — Truncate off-by-one adds … at exact limit (format.ts:20-23).
27. P2 — Folder sidebar fixed 22 cols; long labels silently … (:462, 1169).
28. P2 — Attachment row has no visual separator from body (:298-307).
29. P2 — Unread badge color identical to UI accent (:154, 465) — can't tell mail from chrome.
