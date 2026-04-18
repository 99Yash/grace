# Grace plan

Forward-looking implementation plan. See `prd.md` for product intent and `progress.md` for what's shipped.

## Milestone status

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| M1 | Workspace + walking skeleton | ✅ done | bun workspaces, elysia daemon, opentui+solid TUI, Eden wired |
| M2 | Google OAuth2 + Keychain | ✅ done | loopback+PKCE, `mail.google.com/` scope, keytar storage |
| M3 | IMAP bootstrap + inbox list | ✅ done | drizzle schema, 500-msg bootstrap, `/api/messages`, scrollbox TUI |
| M4 | Real-time IDLE + SSE | ✅ done | in-process event bus, `/api/events`, fetch-based SSE client, sub-second push |
| M5 | Message reader | ✅ done | Enter opens body; hybrid bodies (SQLite text + disk HTML/raw); HTML→text server-side fallback for marketing mail; `v` w3m (capability-gated) / `V` browser-eject; local read-flip |
| M5b | Partial sync + progressive backfill | ✅ done | 1000-msg backfill worker, sync progress pill, `persist.ts` extraction, `/api/capabilities` |
| M5c | Two-phase search (local + remote) | ✅ done | SQLite LIKE + Gmail `X-GM-RAW` stream-merge, `/` overlay (manual keystroke handling, no dropped first char), opportunistic import on remote-only open |
| M6 | Mutations (archive / read / star / trash) | ⬜ next | optimistic UI, IMAP reconcile |
| M7 | Folder sidebar + label pills | ⬜ | switch folders/labels; per-folder IDLE workers |
| M8 | Compose + SMTP send | ⬜ | draft queue, nodemailer, optimistic send |
| M9 | Triage mode | ⬜ | fullscreen one-at-a-time, space-bar through inbox |
| M10 | Command palette | ⬜ | `:` fuzzy over actions + contacts + inbox |
| M11 | Claude features | ⬜ | summarize, draft, NL-select (`. "urgent from stripe"`) |
| M12 | Network resilience + polish | ⬜ | IDLE reconnect-with-backoff, error recovery, docs |

## M5 — Message reader (done)

Landed: Enter opens a body in a right-side reader pane; Esc collapses back to the full list. Hybrid storage — plain-text + metadata in SQLite `bodies` table, HTML and raw `.eml` written to `~/.grace/bodies/<gmMsgid>.{html,eml}`. Capability detection gates `v`; `V` (browser eject) is always available.

- **M5-01 ✅** `GET /api/messages/:gmMsgid/body` — cache-first, IMAP fallback via `withActionClient` singleton (lazy-opened, reconnects once on failure).
- **M5-02 ✅** `packages/mail/fetch-body.ts` — FETCHes `BODY[]` by cached UID, parses with `mailparser`, writes blobs. Accepts `uid` rather than searching by gmMsgid, because imapflow's SearchObject type doesn't expose `gmailMessageId`.
- **M5-03 ✅** `bodies` table: `gm_msgid` PK with `ON DELETE CASCADE` to `messages`, `text` / `html_path` / `raw_path` / `fetched_at` / `size_bytes`. Shaped so FTS5 virtual table is a one-liner later.
- **M5-04 ✅** Split pane — list collapses to ~48 cols with compact columns; reader takes the remainder. `Enter` opens, `Esc` closes.
- **M5-05 ✅** Reader header (subject/from/date/labels) + scrollable body + attachments footer with size.
- **M5-06 ✅** `v` → `w3m -dump -T text/html`, `V` → `open` / `xdg-open`, `t` → back to plain-text. `v` shows toast when `caps.w3m=false`.
- **M5-07 ✅** Server flips `messages.read=true` on body fetch + publishes `mail.updated`; TUI refetches list. IMAP `\Seen` flag push deferred to M6.
- **Follow-up ✅** `html-to-text` server-side fallback — if the parsed text is empty/<20 chars and HTML exists, derive text from HTML and store it. Body route re-derives on cache hits and backfills SQLite. BodyHeader + body lines row-clipped via `<box height={1} overflow=hidden>` so long content doesn't bleed into the list pane. `[idle] failed to start` log enriched with `responseText` / `serverResponseCode` + Gmail connection-cap hint.

## M5b — Partial sync + polish (done)

Landed: grace now operates on a 1000-msg local window per folder. IDLE + backfill run concurrently on independent IMAP connections; progress streams to the TUI via SSE.

- **M5b-01 ✅** `packages/mail/persist.ts` — shared `FETCH_HEADER_FIELDS` + `persistHeaderMessage(db, folderId, msg)`. Consumed by bootstrap, IDLE, and backfill.
- **M5b-02 ✅** `packages/mail/backfill.ts` — `runBackfill({email, clientId, clientSecret, db, folderName, target=1000, batchSize=100, onProgress, signal})`. Walks older UIDs in 100-at-a-time batches with 300ms pauses, stops at target or mailbox exhaustion. Aborts cleanly on SIGTERM.
- **M5b-03 ✅** `folder.sync.progress { folder, done, target }` event type added to `bus.ts` and fanned out via `/api/events`.
- **M5b-04 ✅** Daemon boot spawns backfill alongside IDLE; `AbortController` tied to shutdown.
- **M5b-05 ✅** TUI shows `done/target syncing` pill next to folder count; flips to `synced ✓` briefly then hides. List fetch limit raised to 1000 so backfilled messages surface.
- **Bonus** `/api/capabilities` + startup `Bun.which("w3m")` probe + install-hint log (applies generally; designed for `terminal-notifier`, Kitty graphics, etc. later).
- **Bonus** TUI scrollbox auto-follows selection with a 6-row margin — no more losing the cursor when `j`-ing past the viewport.

## M5c — Two-phase search (done)

Landed: `/` opens a search overlay, typing (200ms debounce) kicks a per-query SSE to `GET /api/search`, local LIKE hits paint instantly, Gmail hits stream in after. Remote-only hits carry an `inLocal=false` flag; opening one POSTs to `/api/messages/import` first so the row lands in the local window before the reader opens.

- **M5c-01 ✅** `GET /api/search?q=...` — per-query SSE. Phase 1: SQLite LIKE on subject/from_name/from_email/snippet, 20 hits sorted desc. Phase 2: action-client `X-GM-RAW` search → batch envelope fetch (cap 50 UIDs), each emitted as its own `hit` event. `seen` set dedupes across phases; `phase`/`done`/`error` events bookend the stream. Aborts on client disconnect.
- **M5c-02 ✅** TUI search overlay — `/` opens; `searchQuery` is driven directly from `useKeyboard` via `e.sequence` (dropped opentui's `<input>` to fix a first-char-drop caused by focus landing after the next keystroke arrived). Debounced `subscribeSseOnce` drives `searchHits[]`. Keybindings are gated: when `searchOpen`, Esc / Enter / ↑ / ↓ / Ctrl-J / Ctrl-K / backspace / space / printable chars all routed through one handler. `SearchHitRow` shows green `L` for `inLocal=true`, yellow `R` for remote-only. Cursor rendered as `▌`.
- **M5c-03 ✅** Opportunistic import — `POST /api/messages/import` accepts a `SearchHit` body and inserts via the same row shape as backfill. TUI only calls it when the Entered hit is `inLocal=false`; otherwise it jumps straight to the reader. Reader now has an `activeMsg` override so search-initiated reads don't need the message to live in the main list first.
- **M5c-04** (deferred) FTS5 virtual table over `messages(subject, snippet)` + `bodies(text)` for phrase search + ranking. `bodies` schema was shaped in M5 to make this a one-liner later.

## M6 — Mutations

`archive`, `mark read/unread`, `star/unstar`, `trash`, `move to label`.

- **M6-01** `POST /api/messages/:id/mutate` route — accepts `{ action: "archive" | "read" | ... }`.
- **M6-02** `packages/mail/mutations.ts` — implements each as IMAP ops (`store +flags`, `move`, label add/remove).
- **M6-03** TUI optimistic UI: local SQLite update → bus event → visual change immediately, server POST in background.
- **M6-04** Reconcile on error: rollback local state + show toast.
- **M6-05** Keybinds: `e` archive, `m` toggle read, `s` star, `#` trash, `l <label>` move.

## M7 — Folder sidebar + label pills

- Left column with folders from `/api/folders`.
- Per-folder IDLE worker spawned on-demand when user selects the folder.
- `Tab` toggles focus between sidebar ↔ list.
- Label pills rendered in each row (especially user's `1: urgent`–`10: marketing` system).

## M8 — Compose + SMTP

- Compose modal overlay (Input × 3 + Textarea).
- Draft auto-save to SQLite every N keystrokes.
- Send: queue mutation → daemon → nodemailer over Gmail SMTP (same OAuth token).
- Optimistic "Sent ✓" in UI immediately.

## M9 — Triage mode

- Dedicated fullscreen view. One email at a time. Three primary actions shown.
- Space = next, keep-and-archive. `a` = archive. `r` = reply (opens compose).
- Inspired by Readdle's Spark / Superhuman.

## M10 — Command palette

- `:` opens a fuzzy finder that searches actions + contacts + inbox simultaneously.
- Actions registered globally, each with `name`, `keybind?`, `onSelect`.
- Pattern lifted from opencode's `dialog-command.tsx`.

## M11 — Claude features

- `s` → summarize selected thread via Anthropic SDK, show in reader pane as side sheet.
- `d` → draft reply from thread context; pre-fills compose.
- `.` → NL prompt → Claude translates to `X-GM-RAW` query → select matching messages for bulk action.
- Requires `ANTHROPIC_API_KEY` in `.env`.

## M12 — Resilience + polish

- IDLE reconnect with exponential backoff on `close` event.
- Network drop recovery (detect, reconnect on `online`).
- Daemon health check route; TUI shows a warning banner when degraded.
- `grace doctor` CLI — prints env/keychain/db/imap status.
- `grace oauth logout` — clears keychain entries.
- README + SETUP.md for a fresh install.

## Cross-cutting concerns

- **Testing:** adopt vitest once a feature is stable enough for regressions to matter. Not before M6.
- **CI:** GitHub Actions on push, running `bun run check-types` + (later) tests.
- **Packaging:** `bun build --compile` → single binary. Target M12.
- **Multi-account:** schema already keys on email in keychain. Add an account switcher in TUI after M9.
- **Notifications:** macOS `terminal-notifier` on new mail when TUI isn't focused. Nice-to-have, post-M8.

## Sequencing rationale

M5 → M6 → M7 is the "make it usable" stretch. M8 adds sending. M9-M11 are the grace-unique features. M12 makes it shippable-for-one. That order keeps every step demoable on its own.
