# Grace progress

Running log of what's shipped, what's working, and what's broken. See `plan.md` for forward direction.

## Timeline

### 2026-04-18 (latest) — M7 folder sidebar + lazy bootstrap

- **M7.** Left sidebar (22 cols) renders the live Gmail folder list from `/api/folders` (which now calls `client.list({ statusQuery: { messages, unseen } })` and merges with SQLite tracked-state; 60s cache with `?refresh=1` bust). Folders sorted INBOX → special-use → user labels. Unread counts in blue. Tab toggles focus between sidebar and list; j/k navigates folders; Enter activates.
- **Lazy bootstrap.** `POST /api/folders/:name/activate` coalesces concurrent calls via a per-folder promise cache. First activate: spawns a fresh IMAP connection, `bootstrapFolder` pulls 500 headers, then fires `runBackfill` to 1000 in the background (guarded against double-fire by a module-scope `Set`). Publishes `folder.sync.progress` + `folder.synced` on the existing bus.
- **TUI switch flow.** `activeFolder` signal drives `createResource(fetchMessages)`, so changing folder auto-refetches. Switch clears pending mutation overlay, selection, reader, and any active search. `folder.sync.progress` events filter to active folder so the pill isn't hijacked by background backfill elsewhere. `mail.received` only triggers list refetch when its `folder` matches active; folder list always refreshes so unread counts stay fresh.
- **Scoped smaller than plan.** IDLE stays pinned to INBOX — non-INBOX folders require manual `r` refresh for new mail. Gmail's 15-conn cap + dev-reload churn argued against per-folder IDLE in this pass. Label pills and `l`-move mutation also deferred (cosmetic + needs picker).

### 2026-04-18 — M6 mutations (read/star/archive/trash)

- **M6.** `POST /api/messages/:gmMsgid/mutate` + `packages/mail/mutations.ts` landed. `applyMutation` uses `messageFlagsAdd/Remove` (`\Seen` / `\Flagged`) for read/star, and `messageMove` to `[Gmail]/All Mail` / `[Gmail]/Trash` for archive/trash. Route is server-authoritative: IMAP first, then SQLite delete-or-update, then `mail.updated` fan-out. Move success deletes the row and the `bodies` cascade handles the text/html/eml blobs.
- **TUI optimistic overlay.** New `pending: Record<gmMsgid, {read?, starred?, removed?}>` signal layered on top of `messages()` via `visibleMessages()`. Archive/trash hide the row instantly; read/star flip the column instantly. Overlay clears on the SSE `mail.updated` for that `gmMsgid` (list refetch returns authoritative state). On mutation failure we roll back + flash a toast.
- **Keybinds.** `m` toggle read, `s` toggle star, `e` archive, `#` trash — working from both the list and an open reader. Archiving/trashing the currently-open message also closes the reader. Help bar updated for both modes.
- **Deferred.** `l <label>` move pushed to after M7 (needs folder picker + imapflow doesn't expose `X-GM-LABELS` high-level; revisit with `client.exec` or folder-as-label moves).

### 2026-04-18 — M5/M5c polish + diagnostics

- **Search first-char drop fixed.** Dropped opentui's `<input>` primitive for the search overlay; `searchQuery` is now driven directly from `useKeyboard` via `e.sequence` for printable chars + explicit handling for `backspace` (meta-backspace clears), `space`, and nav keys. Guarantees the `/` → first-keystroke transition doesn't lose a char, and sidesteps a focus-timing race where the input mounted after the next key arrived. Cursor rendered as `▌`.
- **HTML-only emails now render usable text.** Added `html-to-text` (server-side) in `@grace/mail`: `deriveTextFromHtml` + `isTextUseful` helpers. `fetchMessageBody` calls it when the parsed `text` is empty or <20 chars but HTML is present. The body route also re-derives on cache hits (backfilling SQLite) so already-cached marketing mail re-renders without a refetch. The "(no plain-text part)" fallback now only shows for genuinely empty messages.
- **Reader render clipping.** BodyHeader rows wrapped in `<box height={1} overflow="hidden">` so long subjects/from/dates clip inside their row instead of bleeding into the list pane or folder header. The 80-char `─` divider replaced with a flex-sized 1-row `<box backgroundColor>` that fills the exact pane width. Body lines similarly row-clipped (long lines truncate rather than wrap/bleed; word-wrap is future polish).
- **IMAP error log enriched.** Server `[idle] failed to start` now prints `responseText`, `serverResponseCode`, and the Gmail 15-conn-cap hint when applicable — no more opaque "Command failed".

### 2026-04-18 (late) — M5c two-phase search

- **M5c — Search.** `GET /api/search?q=...` returns a per-query SSE stream (`hit` / `phase` / `done` / `error` events). Phase 1 is SQLite `LIKE` on subject/from/snippet capped at 20; phase 2 is Gmail `X-GM-RAW` via the action-client (batch envelope fetch, cap 50 UIDs). Each remote hit carries `inLocal: boolean`; a cross-phase `seen` set dedups. Verified on "stripe": 3 local LIKE hits + 48 Gmail hits, 20 overlapping, 28 genuinely remote-only.
- **TUI overlay.** `/` opens a search overlay with `<input focused>`, 200ms debounce, `subscribeSseOnce` (new; no auto-reconnect variant of the SSE helper) driving the hit list. Keyboard gating: when `searchOpen && !readerOpen`, only `escape` / `return` / `↑` / `↓` / `Ctrl+J` / `Ctrl+K` are intercepted — everything else flows through to the input. Badge is green `L` for `inLocal` hits, yellow `R` for remote-only.
- **Opportunistic import.** `POST /api/messages/import` accepts a `SearchHit` shape and inserts into `messages`. TUI only fires it on Enter for remote-only hits; local hits go straight to the reader. New `activeMsg` signal overrides the list-selection path so search-driven reads don't require the message to live in `messages()` first.

### 2026-04-18 (evening) — M5 + M5b

- **M5 — Message reader.** `GET /api/messages/:gmMsgid/body` with cache-first lookup + IMAP fallback via a lazily-opened singleton action client (separate from the IDLE connection, reconnects once on failure). `packages/mail/fetch-body.ts` FETCHes `BODY[]` by cached UID and parses with `mailparser`. Hybrid storage: plain text + metadata in new `bodies` SQLite table (cascade-delete to `messages`, FTS5-ready shape); HTML + raw `.eml` on disk at `~/.grace/bodies/`. TUI reader pane with header, scrollable body, attachments footer. Keybinds: `Enter` open, `Esc` close, `v` w3m-dump, `V` browser eject, `t` back to plain. Opening flips `messages.read=true` + publishes `mail.updated` (IMAP `\Seen` deferred to M6).
- **M5b — Backfill + polish.** Extracted `FETCH_HEADER_FIELDS` + `persistHeaderMessage` into `packages/mail/persist.ts` (shared by bootstrap / IDLE / backfill). `packages/mail/backfill.ts` — `runBackfill()` on its own IMAP connection, walks older UIDs in 100-at-a-time batches with 300ms pauses until target (1000 default). Daemon boot fires IDLE + backfill concurrently; abort tied to shutdown. New `folder.sync.progress` bus event, SSE-fanned to TUI; `done/target syncing` pill renders in the folder header. TUI list limit raised to 1000 and the scrollbox now auto-follows selection with a 6-row margin.
- **Capability detection.** `/api/capabilities` + startup `Bun.which("w3m")` probe. Logs `w3m not found — brew install w3m` once at boot. TUI gates `v` on `caps.w3m`; `V` browser eject always works. Pattern extends to `terminal-notifier`, Kitty graphics, etc.

### 2026-04-18 — M1 through M4 in one day

- **M1 — Walking skeleton.** Bun workspaces + catalog, Turbo, Elysia daemon on `127.0.0.1:3535`, opentui+Solid TUI connected via Eden Treaty. `bunfig.toml` with solid preload; `dev:tui` script bypasses turbo to preserve TTY.
- **M2 — OAuth2.** Google Cloud project "grace" (Desktop app client), loopback + PKCE, `https://mail.google.com/` scope. Tokens in macOS Keychain via `@napi-rs/keyring`. `bun run oauth:login` works end-to-end. `/api/auth/status` reports signed-in email. TUI displays it.
- **M3 — IMAP bootstrap.** `@grace/auth` refresh helper (`getFreshAccessToken`). `@grace/mail` IMAP client via XOAUTH2. `@grace/db` Drizzle + bun:sqlite at `~/.grace/grace.db`. Bootstrap worker pulls last 500 INBOX headers in ~3s. `/api/messages` paginated list. TUI renders scrollbox with j/k nav, unread/starred glyphs, relative dates, manual `r` refresh.
- **M4 — Real-time.** In-process typed event bus (`@grace/api` bus.ts) + `/api/events` SSE route. IDLE worker on INBOX (listener attached before `mailboxOpen`, which was the key to sub-second push). TUI fetch-based SSE client (EventSource unavailable in opentui preload context) with auto-reconnect. On new mail: server fetches + inserts + publishes → TUI flashes green toast + refetches.

## What works

- Sign in via browser OAuth flow with PKCE.
- Token refresh on expiry; no user action required after initial login.
- Local SQLite cache with a rolling 1000-msg window per folder. Initial bootstrap is fast; `runBackfill` fills older headers in the background, reporting progress via SSE.
- TUI renders inbox with subject / sender / date columns, unread `●` and starred `★` indicators, selection highlight in blue. Scrollbox auto-follows selection with a 6-row margin.
- `j`/`k`/`g`/`G` navigation, `r` manual refresh, `/` opens search, `Enter` opens body, `Esc` closes reader or search overlay.
- **Two-phase search.** `/` → input overlay. Local SQLite hits paint instantly (green `L`), Gmail `X-GM-RAW` hits stream in (yellow `R` when not yet in local cache). Enter on a remote-only hit imports the header first, then opens the body. Debounced per keystroke; aborts in-flight stream on new query.
- **Reader pane:** plain-text body with header (subject/from/date/labels) and attachments footer. HTML-only messages auto-derive text via `html-to-text` server-side; `v` → `w3m -dump` rich render (if installed), `V` → open HTML in default browser, `t` → back to plain-text. Header rows + body lines clip inside their row (no bleed into the list pane).
- **Hybrid body storage:** text + metadata in SQLite `bodies` table; HTML + raw `.eml` at `~/.grace/bodies/<gmMsgid>.{html,eml}`. Cache hits serve in ~10ms.
- **Capability detection:** `/api/capabilities` reports `{ w3m }`; TUI gates `v` accordingly, shows install hint on attempted use when missing.
- **Local read-flip:** opening a message flips `read=true` in SQLite + publishes `mail.updated`; list dot updates reactively across windows.
- `● live` / `○ offline` / `◌ connecting` status in header reflects SSE state; sync-progress pill (`done/target syncing` → `synced ✓`) during backfill.
- Real-time new-mail push: typically <1s from Gmail to TUI flash. Verified with multiple self-sent test mails.
- Multi-window: any number of TUI processes can attach to the same daemon concurrently (each opens its own SSE stream).
- Option+Backspace / Option+Shift+Backspace work for word-delete and line-start-delete in Input/Textarea.

## What's broken / known limits

- **No reconnect on network drop.** If WiFi dies, imapflow emits `close`; daemon logs it but doesn't re-establish IDLE. Restart server to recover. Fix in M12.
- **Only INBOX is live.** No folder sidebar yet; no per-folder IDLE or backfill. Fix in M7.
- **Can't act on messages.** Archive / star / trash / reply / compose all absent; only opening-flips-read works. Fix in M6 + M8.
- **Search is INBOX-only and cap 50 remote UIDs.** No folder selector, no `[Gmail]/All Mail` crawl, no FTS5 yet. M5c-04 + M7 lift these.
- **Search local phase uses `LIKE '%q%'`.** Doesn't parse Gmail operators (`from:x is:unread older_than:30d`) locally — those just go through to the remote phase. FTS5 virtual table over bodies is M5c-04.
- **IMAP connection churn on dev restart.** Gmail caps at 15 concurrent. Mitigated by (1) port guard — `apps/server/src/index.ts` probes `/api/health` on boot and exits if a daemon is already running, so a second `bun run dev:server` can't silently pile on IDLE connections; (2) SIGHUP shutdown handler, so closing a terminal releases the slot cleanly; (3) switched server dev from `bun --hot` to `bun --watch` so each save does a full SIGTERM → clean logout → fresh IDLE instead of leaking the old one. If you do end up with stragglers: `ps -eo pid,etime,command | grep -E 'turbo.*-F server|apps/server/src/index'` then kill the PIDs.
- **Reader body long lines clip instead of wrapping.** Good enough for real email (most lines are &lt;80 cols); press `V` to open in browser if a message has pathological single-line HTML stripped to one row. Real word-wrap is future polish.
- **Backfill is single-folder.** Only INBOX backfills today. Multi-folder comes with M7.
- **Pre-existing imapflow type friction.** `bootstrap.ts` and `idle.ts` have residual `error TS2339` on `msg.emailId` / `from.mailbox|host` — runtime fine, types lag. Left untouched until it causes a problem.
- **Testing-mode OAuth refresh tokens expire after 7 days.** Will need to re-run `oauth:login` weekly or publish the app.

## Current shape

```
grace/
├── apps/
│   ├── server/  — Elysia daemon, starts IDLE on boot, hosts /api/*
│   └── tui/     — opentui+Solid client, fetch-SSE, Eden-typed calls
├── packages/
│   ├── api/     — Elysia routes (auth, folders, activate, messages, body, mutate, capabilities, search, import, events) + bus + imap-action singleton
│   ├── auth/    — OAuth2 flow + keychain + refresh helper
│   ├── db/      — Drizzle schema (folders, messages, bodies) + bun:sqlite client
│   ├── mail/    — IMAP client + bootstrap + IDLE + backfill + fetch-body + mutations + list-folders + shared persist helper
│   ├── env/     — zod-validated env
│   └── config/  — shared tsconfig base
└── docs: prd.md · plan.md · progress.md · research.md · README.md
```

## Running it

```bash
bun install
bun run oauth:login      # one-time (weekly in Testing mode)
bun run dev:server       # one pane — daemon + IDLE
bun run dev:tui          # another pane — TUI
```

Smoke tests:
- `bun run smoke:imap` — connect + list mailboxes + INBOX stats.
- `bun run smoke:bootstrap` — pull/upsert N messages into SQLite.

## Next

M8 — compose + SMTP send. Keep M7 follow-ups (per-folder IDLE, label pills, `l` move) parked until M12 lands connection lifecycle / reconnect.
