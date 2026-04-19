# Grace UI refresh — 7-phase plan

A structured plan for lifting grace's TUI closer to opencode's level of polish by porting its primitives (theme, dialog stack, keybind context, command registry) rather than its product surface. Framework adapted from [Matt Pocock's 7 Phases of AI Development](https://www.aihero.dev/my-7-phases-of-ai-development).

Related docs: `plan.md` (milestones), `prd.md` (product intent), `progress.md` (shipped), `uiux.md` (29 catalogued rough edges).

---

## Phase 1 — The Idea

**Problem.** Grace works but doesn't yet *feel* designed. The TUI is one 1,668-line `apps/tui/src/index.tsx` with ~136 inline hex colors, mode-gated `useKeyboard` dispatch, plain-var compose state, a single-slot toast, and no command palette or help modal. Every new feature from `plan.md` (M9 triage, M10 palette, M11 Claude features) will compound on that foundation — or erode it further.

**Insight.** Opencode — a peer opentui+Solid app — solves the same primitives we need. Its standout ideas aren't the *features* (MCP indicators, plugin routes, etc.) but three small architectural decisions that radiate outward:

1. **Decoupled command registry.** Any component calls `register(() => CommandOption[])`; palette, keybinds, and slash autocomplete all read it.
2. **Leader-key keybind context.** Config-driven keybinds, `match()` helper, 2s leader window with focus blur/restore.
3. **Dialog stack with focus restoration.** `DialogProvider` owns a stack; Esc pops; focus snaps back.

Everything else (themes, toasts, spinner, fuzzy search) plugs into those three.

**Goal of this refresh.** Port the primitives — not the product surface — so the remaining milestones land on a foundation that feels intentional instead of improvised. Done right, this is a one-week refactor that unlocks the next three months of work.

**Non-goals.**
- Copying opencode's visual identity (we are an email client, not a coding agent).
- Porting MCP footer indicators, plugin route system, autocomplete infra, or prompt stash.
- A full rewrite. Most file boundaries stay; the monolith gets split and rewired through context.

---

## Phase 2 — Research

The two survey artifacts that justify this plan live in-session (transcripts from the analysis pass on 2026-04-19). Their key findings are cached here so future agents don't re-derive them.

### Grace — current state (`apps/tui/src/index.tsx`)

| Area | State | File anchors |
|------|-------|-------------|
| Layout | 5-zone (top bar, folder header, sidebar+list+reader, help bar). Sidebar pinned 22 cols, reader pinned 48. No virtualization. | `index.tsx:1221-1422` |
| Keyboard | Mode ladder: compose → sidebar → search → reader → list → global. No chords, no configurability. Search overlay manually collects keystrokes via `e.sequence`. | `index.tsx:1082-1216` |
| Overlays | Compose + Search. Each is its own `Open()` signal; `<Show>` replaces list pane. No focus save/restore. | `index.tsx:419-486`, `557-666` |
| State | Signals + `createResource`. Compose fields are plain `let` vars, not signals. | `index.tsx:716-721` |
| Theme | 136 inline hex values. No tokens. Unread accent (`#4da3ff`) collides with selection color. | whole file |
| Toasts | Single `toast()` signal cleared via `setTimeout`. Overwrites on collision. | `index.tsx:683, 1014-1017` |
| Reader | Plain-text preferred, HTML→text fallback, optional `v` w3m. No word-wrap, no quote collapse, no link extraction. | `index.tsx:318-380` |
| Startup | No in-TUI onboarding. Requires external `bun run oauth:login`. "Daemon unreachable" shown with no hint. | `apps/server/src/index.ts` |

### Opencode — primitives worth porting (`/Users/yash/Developer/self/oss/opencode`)

| Primitive | File | Why it matters |
|-----------|------|---------------|
| Theme context + 28 JSON themes | `packages/opencode/src/cli/cmd/tui/context/theme.tsx` + `context/theme/*.json` | `useTheme()` yields named tokens; `selectedForeground()` computes contrast. Unlocks retheming + light mode. |
| Dialog stack | `.../tui/ui/dialog.tsx` | `DialogProvider` stacks `{element, onClose}`. Esc pops. Restores prior focused renderable. Handles mouse-selection dismissal edge case. |
| Keybind context | `.../tui/context/keybind.tsx` | Leader key with 2s window + auto-blur/refocus. `match()` handles mods + leader. `keybind.print()` renders "spc j" in UI. |
| Command registry | `.../tui/component/dialog-command.tsx` (lines 33-136) | Decentralized `register(() => CommandOption[])`. Suggested items shown first when filter empty; full list on type. Fuzzy search via `fuzzysort` weighted (title 2x category). |
| `DialogSelect<T>` | `.../tui/ui/dialog-select.tsx` (lines 86-192) | Reusable fuzzy-list with categories, scroll centering, arrow + Ctrl+N/P + PgUp/Down + Home/End nav. |
| Toast manager | `.../tui/ui/toast.tsx` | Single active toast, variants (success/error/warning/info), auto-dismiss, top-right, word-wrap. |
| Prompt history | `.../tui/component/prompt/history.tsx` | 50-entry JSONL at `~/.opencode/prompt-history.jsonl`, self-healing on corruption, arrow-up/down cycle. |
| Spinner (Knight Rider) | `.../tui/ui/spinner.ts` | Exponential-alpha trail, bloom, bidirectional motion with hold frames. Pure polish. |

### Constraints to remember

- **Gmail caps at 15 concurrent IMAP connections.** Dev reloads already push us close — informs M7 deferral of per-folder IDLE.
- **Opentui has no virtual list.** Large inboxes (>500) stutter. Manual windowing needed.
- **Daemon/TUI split.** Anything "state" that isn't purely UI belongs over SSE/HTTP, not in TUI memory.

---

## Phase 3 — Prototyping

Two design choices carry enough taste-weight that we should prove them in a throwaway branch before committing to the full refactor.

### Proto A — Theme tokens

**Question.** What's the right shape for our theme object? Opencode uses ~30 named colors (`text`, `background`, `primary`, `muted`, `accent`, plus semantic `success`/`warning`/`error`/`info`). Grace has 136 inline values — most of which collapse into ~12 roles.

**Proto.** Branch off and replace the colors in *just* `MessageRow` + `BodyHeader` with a minimal `theme.ts`. Pick: do we ship one theme first (polished dark) or two (dark + light) before committing? Does a Catppuccin-derived palette feel right for an email app, or do we want something more restrained?

**Decision artifact.** `packages/tui/src/theme/tokens.ts` with final token names + one theme file. 2-hour spike.

### Proto B — Command palette UX

**Question.** Opencode's palette is invoked by a leader chord. For an email app with finger-on-home-row navigation, is leader+`p` right, or should `:` (vim-style) be the entrypoint? Does the palette show suggestions pre-type (opencode does), or jump straight to fuzzy mode?

**Proto.** Hard-code five commands (compose, archive, star, toggle-read, switch-folder) behind `:` in a scratch branch; test against the real list-nav keybinds we use daily. Decide whether suggestions-first or fuzzy-first feels better.

**Decision artifact.** A short `refresh-decisions.md` note capturing the entrypoint key, suggestion behavior, and the first 10 commands to register. 2-hour spike.

Skip prototyping for the other ports — dialog stack, keybind context, toast manager are structural enough that opencode's shapes are defensible as-is.

---

## Phase 4 — PRD (end-state UX)

What a user sees after this refresh lands, stated from their perspective. No implementation details.

### Visual
- Grace opens in a theme chosen in a top-level `~/.grace/config.json`. A themes dialog (`:themes` or a keybind) lets them cycle live. Two ship in v1: a polished dark and a readable light.
- Unread mail is distinctly colored from the selection highlight — never ambiguous at a glance.
- Colors across sidebar, list, reader, overlays, and status bar feel like one palette, not five.

### Interaction
- `?` opens a help modal listing every keybind, grouped (Navigation / Mail actions / Views / Compose / Global). Keybinds render in user notation ("spc a", not the raw config value).
- `:` opens a command palette. Typing fuzzy-filters over every action the app knows (archive, star, compose, switch folder, pick label, change theme, toggle density, …). With an empty filter, the five most-used commands are shown first.
- A leader key (space by default, configurable) enables chords: `space a` archive, `space s` star, `space c` compose. Esc or 2s timeout exits leader mode. Current focused renderable is blurred during the leader window and refocused after.
- Keybinds are configurable in `~/.grace/config.json`. A bad config shows a toast on startup, not a crash.

### Overlays
- Compose, search, help, command palette, themes picker, and label picker all stack. Esc pops one. Each one restores focus to whatever was focused before it opened.
- Closing compose with unsaved content shows a confirm dialog (discard / keep editing). Drafts persist to disk; `c` reopens the last unsaved draft unless the user explicitly discards.

### Status & feedback
- Toasts stack vertically at top-right, auto-dismiss by variant (success 2s, warning 4s, error 6s). Multiple concurrent toasts never overwrite.
- Send-in-progress, sync-in-progress, and search-in-progress each have distinct, calm indicators — no visual thrash when two overlap.

### Onboarding
- First run with no keychain token shows an in-TUI screen: title, one-line explanation, `Press Enter to authorize` → spawns OAuth flow → returns to inbox. No external `bun run oauth:login` step required.
- If the daemon is unreachable mid-session, the TUI shows a banner with "retry" affordance instead of a silent dead state.

### Non-visible quality
- Every new feature from `plan.md` M9+ can be built by registering commands and keybinds — no further edits to a central switch statement.
- Swapping colors across the whole app is a one-file edit.

---

## Phase 5 — Implementation planning

Kanban shape. Tickets are sized to one focused session each (~2-4 hours). Blocking relationships are explicit so parallel work is obvious.

### Swimlane 1 — Foundations (sequential, blocks everything else)

| ID | Ticket | Blocks | Notes |
|----|--------|--------|-------|
| ✅ **R1** | Split `apps/tui/src/index.tsx` into `components/` (Reader, Compose, Search, Sidebar, MessageList, Header, HelpBar) with a shared `state/` context | R2, R3, R4 | Pure refactor. Zero behavior change. Preserves every existing keybind. |
| ✅ **R2** | Introduce `theme/tokens.ts` + `ThemeProvider` + `useTheme()`. Replace inline hex values. Ship one dark theme as JSON. | R5, R6, R7, R8 | Follows Proto A decisions. |
| ✅ **R3** | Introduce `ui/dialog.tsx` — module-level stack with focus save/restore + `DialogHost` Esc handler. Compose + search both route through `dialog.open`/`dialog.close`. | R5, R6, R7 | Removes bespoke `composeOpen`/`searchOpen` signals (now derived from stack). Reader stays outside the dialog stack — it's a pane split, not an overlay. |
| ✅ **R4** | Introduce `context/keybind.tsx` — config-driven keybinds, `match()`, leader key with 2s window. Migrate current bindings. | R5, R6 | No behavior change in bindings themselves; wiring only. |

### Swimlane 2 — Primitives (parallelizable after R1-R4)

| ID | Ticket | Blocks | Notes |
|----|--------|--------|-------|
| ✅ **R5** | `ui/toast.tsx` — stacked top-right, variants, per-variant auto-dismiss. Migrate callers. | — | Independent after R1-R3. |
| ✅ **R6** | `ui/dialog-select.tsx` — fuzzy-searchable list with categories, scroll-centering, vim keys. | R9, R10 | Based on opencode's DialogSelect. Trimmed: no gutter/margin/keybind hints/mouse (palette doesn't need them). Custom fuzzy scorer (no `fuzzysort` dep). Scroll centering via opentui's built-in `scrollChildIntoView`. |
| ✅ **R7** | `ui/help-dialog.tsx` — reads keybind registry, renders grouped. Bound to `?`. | — | Added `app.help` binding (`?,shift+/`). Renders every action from `kb.all`, grouped by prefix with pretty labels. Shows leader key in header. |
| ✅ **R8** | Second theme (light) + `:themes` picker dialog. | — | Theme reactive via module-level `createStore<Theme>`. Ships `light.ts` alongside `dark.ts`. Picker at `<leader>+t` → `DialogSelect<Theme>` with live preview on arrow-nav, commit on enter, revert on esc via `onClose` hook. |

### Swimlane 3 — Command system + payoff (after primitives)

| ID | Ticket | Blocks | Notes |
|----|--------|--------|-------|
| ✅ **R9** | `component/command-registry.ts` — `register(() => CommandOption[])` + central store. | R10 | Landed at `ui/command-registry.ts` to sit alongside `dialog`/`toast` primitives. Module-level `createRoot(createMemo(...))` flattens provider outputs reactively; `register` returns a disposer. Exposes `all/visible/suggested/find/trigger` + `CommandOption` type with `keybind`/`suggested`/`hidden`/`enabled` flags. |
| ✅ **R10** | `component/command-palette.tsx` — bound to `:`. Suggestions-first behavior. Wired through DialogSelect (R6). | R11 | Landed at `ui/command-palette.tsx`. Bound `app.palette` to `:,shift+;`. Filter signal tracked via `onFilter`; when empty, suggested commands render under a "Suggested" category followed by the rest. Opens via `slot: "content"` (replaces list/reader pane). |
| ✅ **R11** | Register first 10 commands: compose, archive, star, toggle-read, trash, switch-folder, refresh, search, help, themes. | — | Landed at `apps/tui/src/commands.tsx`. `<CommandRegistry />` mounted inside `Layout` — `commands.register(...)` returns a disposer wired to `onCleanup`. Provider reads `s.currentMsg()` reactively: title flips ("Mark as read" ↔ "Mark as unread"), `enabled: hasMsg` hides mail-row commands when no message is selected. `switch-folder` opens a new `ui/folder-dialog.tsx` fuzzy picker (DialogSelect over `orderedFolders()`). Three `suggested: true` items (compose, search, switch-folder) render under the palette's "Suggested" category when the filter is empty. |

### Swimlane 4 — UX debt paydown (opportunistic, any time after R1)

| ID | Ticket | Notes |
|----|--------|-------|
| ✅ **R12** | Compose state → signals + draft persistence (JSONL at `~/.grace/drafts/`). | Covers `plan.md` M8 deferred. `composeTo/Subject/Body` are now signals; writers set signals directly, mount callbacks prefill inputs from signals. Daemon routes at `packages/api/src/routes/drafts.ts` (GET/PUT/DELETE `/api/drafts/current`) persist a single JSONL line to `${GRACE_DATA_DIR}/drafts/drafts.jsonl` (append-ready for history). `openCompose()` is async, fetches current draft on entry and restores into fields + status line ("draft restored · …"). 500ms debounced autosave effect runs while compose is open (pauses during `composeSending`); empty content triggers DELETE. Successful send clears the draft + resets signals; failed send keeps it for next open. Esc leaves the draft intact (confirm-dialog deferred). |
| ✅ **R13** | Reader word-wrap + quote-block fold + link extraction. | Body now renders via `<text wrapMode="word" width="100%">` per segment — no more per-line truncation. `parseReaderBody()` in `format.ts` splits into `text`/`blank`/`quote` segments (quoted = any line matching `/^\s*>/`). Consecutive quote lines collapse to `— N quoted lines · press z to expand —`; `reader.toggleQuotes` (`z`) flips global fold. `extractUrls()` finds unique `https?://` URLs (trims trailing punctuation) and `readerLinks()` is a memo on the current body text. A "links:" block renders after the body with `[N] url`; pressing plain `1`–`9` in the reader opens the N-th link via `openInBrowser`. `quotesExpanded` resets to false on each new bodySource so every message starts folded. Help dialog auto-picks up the new binding via `kb.all`; label added to `help-dialog.tsx`. |
| **R14** | List virtualization (manual viewport buffer). | `uiux.md` #11. Only if backlog > 500 lags. |
| **R15** | In-TUI OAuth onboarding screen. | Removes the external `bun run oauth:login` wart. |

### Acceptance criteria (applies to all tickets)

- `bun run check-types` passes.
- Every previously working keybind still works.
- No regressions in SSE reconnect, IDLE push, backfill progress, or mutation optimism.
- No increase in lines of code under `apps/tui/src/` (the refactor should *shrink* the codebase, not grow it).

---

## Phase 6 — Execution

### Suggested order

**Week 1 — foundations (strictly sequential).**
R1 → R2 → R3 → R4. No behavior change visible to the user, but the codebase shape is now right.

**Week 2 — primitives (parallel).**
R5 + R6 + R7 + R8 can run concurrently. Each is a self-contained ~3-hour ticket.

**Week 3 — payoff.**
R9 → R10 → R11. This is where grace suddenly feels like a different app.

**Ongoing — debt paydown.**
R12-R15 slot in between other `plan.md` work. R12 unblocks completing M8; R13 closes `uiux.md` items.

### Guardrails

- One PR per ticket. Each PR shows a before/after screenshot or screencap.
- Keep `plan.md` milestone status table in sync — add an `R*` column or cross-reference.
- When something feels hard, re-read opencode's source instead of inventing. Their solutions are usually sufficient.
- **Resist scope creep.** If a ticket wants to grow, split it into another ticket. The Kanban shape only works if units stay small.

---

## Phase 7 — Quality assurance

### Smoke checklist (every PR)

- [ ] Launch grace. Inbox loads, folder list populates, IDLE pushes new mail.
- [ ] `j`/`k` navigate. `Enter` opens reader. `Esc` closes.
- [ ] Compose opens, sends, closes. Error path surfaces in UI.
- [ ] Search (`/`) opens, finds local + remote hits, opens remote hit via import.
- [ ] Mutations: `m`, `s`, `e`, `#` all round-trip through SSE and clear pending overlay.
- [ ] Folder switching via sidebar still lazy-bootstraps + backfills.

### Refresh-specific QA (before calling the refresh "done")

- [ ] Grep `apps/tui/src/` for `#[0-9a-f]{6}` — count should be ~0 outside of `theme/`.
- [ ] Every keybind shown in `?` help actually works.
- [ ] Leader key: press `space`, wait, watch focus blur; press `a`; archive fires; focus returns.
- [ ] Open compose, search, help, palette, themes picker in sequence. Esc pops each one. Focus lands exactly where it was.
- [ ] Trigger three toasts in <1s. All three visible, dismiss on their own schedules.
- [ ] Swap theme via palette. All panes re-render with new colors. No hex leftovers.
- [ ] Force a daemon crash during use. TUI shows banner, not silent death.
- [ ] `bun run check-types` clean. No console warnings on startup.

### Feel check (human, non-mechanical)

Pick five real inbox tasks (archive a batch, reply to one, search for a sender, star three threads, compose a new mail). Perform each using only the new palette + leader keys. If any task feels awkward, file a ticket — don't paper over it.

### Sign-off

When the smoke checklist + refresh-specific QA pass, and the feel check has no open tickets worse than "nice to have," tag `v0.2-refresh` and move on to `plan.md` M9 (Triage mode) — which should now feel trivial, because the primitives are already there.
