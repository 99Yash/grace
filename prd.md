# Grace V1 PRD

## Product intent

Build a terminal email client for Gmail that feels instant, stays out of the way, and uses the affordances a TUI has over a web client — keyboard-first navigation, composable with the shell, and room for AI-powered triage that the Gmail web UI can't match.

## Problem statement

Gmail's web UI is built for breadth — every feature, every workflow, every persona. That breadth comes at a cost: every action takes multiple clicks, attention is fragmented across tabs, and power-user shortcuts are hidden behind a menu system. For someone who lives in a terminal and processes high volumes of email, the web client is slow by construction.

Grace is a focused alternative: one person, one terminal, their Gmail. Designed to make inbox-zero in 20 minutes feel good instead of exhausting.

## Goals

- Real-time: new messages appear without manual refresh; outgoing messages feel sent the moment you press enter.
- Keyboard-first: no action worth doing should require more than a two-key chord.
- Offline-capable reads: the local SQLite cache is the source of truth for the UI; the network is a background concern.
- Leverage Claude: summarize, draft replies, and translate natural language into Gmail search queries.
- Extensible: a shell-composable CLI surface so the TUI is the default UX but not the only one.

## Non-goals (v1)

- Multi-account support. Single Gmail account.
- Non-Gmail providers (IMAP in general). Gmail-specific from day one — use `X-GM-*` extensions, lean into labels.
- Rich HTML email rendering. Plain text by default, `w3m -dump` on demand, browser eject for the rest.
- Calendar, contacts, tasks. Email only.
- Mobile or web surfaces. Terminal only.
- Multi-machine sync of local state. The daemon runs where you run it.
- Filter/rule builder UI. Gmail already has server-side rules; defer to them.

## User

- Primary: me (yash). Single Gmail account, macOS, modern terminal (Ghostty / iTerm2 / WezTerm / Kitty — anything that forwards Option as Meta).
- Secondary (future): other terminal power users. Out of scope for v1 polish.

## Architecture

Two processes on the same machine. The TUI is a thin client; the daemon is the source of truth.

```
┌──────────────────┐   HTTP + SSE    ┌──────────────────────────────┐
│ TUI              │ ───────────────→│ Daemon (Elysia, Bun)         │
│ opentui + Solid  │  loopback only  │  - SQLite via Drizzle        │
│ Eden Treaty      │                 │  - Effect PubSub event bus   │
└──────────────────┘                 │  - IMAP IDLE (imapflow)      │
        ↑                            │  - SMTP (nodemailer)         │
        │    any # of TUIs           │  - OAuth2 + token refresh    │
        │    attach via SSE          │  - macOS Keychain (keytar)   │
        └──── events ─────────── Bus.publish('mail.received', …)
```

**Why this split:**
- Daemon keeps IMAP IDLE alive even when no TUI is open → opening the TUI is instant (SQLite read), never "syncing…".
- Multi-window is free: any number of TUIs can SSE-subscribe to the same daemon.
- OAuth tokens live in one place.
- Clean separation: TUI owns UX, daemon owns state + network.

**Why not Replicache:** For a single-daemon-per-user shape, Replicache's multi-client-against-remote-server value adds more complexity than benefit. The opencode pattern (mutation POST → SQLite write → bus publish → SSE fan-out) covers the same ground with less machinery. Revisit if we ever go multi-device with a shared cloud server.

## Technical stack

| Layer | Choice |
|---|---|
| UI | `@opentui/core` + `@opentui/solid` |
| Reactivity | SolidJS (fine-grained, no reconciliation cost) |
| Daemon framework | Elysia + Eden Treaty (end-to-end types, no codegen) |
| Event bus | Effect `PubSub.unbounded` + SSE |
| Local store | SQLite via Drizzle, `@rocicorp/zero-sqlite3` driver |
| IMAP | `imapflow` (IDLE, CONDSTORE, OAuth2) |
| SMTP | `nodemailer` (same OAuth2 credentials) |
| Auth | Google OAuth2 (loopback redirect flow), tokens in macOS Keychain via `keytar` |
| AI | `@anthropic-ai/sdk` |
| HTML render | plain-text default · `w3m -dump` on `v` · browser eject on `V` |
| Images | Kitty/Sixel graphics protocol where terminal supports it |
| Workspace | Bun workspaces + catalog, Turbo, tsdown |

**Reference implementations:**
- `/Users/yash/Developer/self/orys` — Bun+Elysia+Turbo layout template.
- `/Users/yash/Developer/oss/opencode` — daemon+TUI architecture, SSE bus pattern, command palette, Solid store sync pattern.

## Sync strategy

1. **Bootstrap (first run):** fetch headers + metadata for the last ~1000 messages per watched folder via IMAP `FETCH`. Stream in so the UI paints within seconds. Bodies loaded lazily on open.
2. **Resume (reconnect):** Gmail supports CONDSTORE/QRESYNC (RFC 7162). Store the last-seen `HIGHESTMODSEQ` per folder, pull deltas in one round trip even after days offline.
3. **Real-time:** one IMAP IDLE connection per watched folder. Gmail drops idle after ~29 min; `imapflow` auto-reconnects with backoff.
4. **Outbound:** mutation "sendMessage" → SQLite queue → daemon calls SMTP → bus publishes `send.completed`. TUI shows optimistic "Sent ✓" immediately, flags red if SMTP ultimately fails.

## v1 features (MVP)

Table-stakes:
- Three-pane layout: folders/labels · message list · reader.
- Keyboard navigation (`j`/`k` list, `Enter` open, `g i` inbox, `g s` sent, etc.).
- Optimistic mutations: `archive`, `mark read/unread`, `star`, `trash`, `move`.
- Compose, reply, reply-all, forward. Plain-text body with signature; attachments via file-path argument.
- Send via SMTP with optimistic feedback.
- Search: local SQLite FTS5 by default, fall through to Gmail's `X-GM-RAW` for anything we don't have locally.
- HTML handling: plain-text default, `v` for `w3m -dump`, `V` for browser eject.

Creative features locked in:
- **Triage mode** — fullscreen, one email at a time, three primary actions. Space-bar through the inbox like Tinder. The killer feature for 200-unread days.
- **Command palette** — `:` or `Cmd+K` opens fuzzy finder over actions + inbox + contacts simultaneously. Single registry for all commands; leader-key chord support.
- **Claude triage**:
  - `s` — summarize thread in a side pane.
  - `d` — draft reply using thread context.
  - `.` — natural-language select ("all Stripe emails older than a month") → Claude translates to `X-GM-RAW`.

## Deferred / future (post-v1)

- Tree-structured conversation view (indented reply graph).
- Shell-composable CLI (`gracectl list`, `gracectl send`, etc.).
- Plugin surface (`~/.grace/plugins/*.ts`).
- Inline image preview via Kitty graphics protocol.
- Multi-account support.
- Snooze / schedule-send.
- Ghost-read mode (cursor preview without marking read — may promote to v1 if trivial).
- Auto-labeling rules ("all receipts → Finance label") via Claude.

## Open questions

- **Thread model:** Gmail's `X-GM-THRID` gives conversation grouping. Store threads as first-class entities in SQLite, or always derive from message list? Leaning first-class.
- **Attachment policy:** download-on-open lazy-fetch vs. pre-fetch when message arrives. Leaning lazy.
- **Notifications:** use macOS system notifications (via `terminal-notifier` or similar) when daemon sees new mail but no TUI is attached? TBD.
- **Color scheme:** single theme for v1 or theming system? Probably single theme.
- **Graceful degradation when Claude API key missing:** hide AI actions or show disabled with tooltip?

## Milestones (walking skeleton)

Each milestone is a demoable slice that unblocks the next.

1. **Scaffold** — Bun workspace, Elysia daemon, opentui+Solid TUI with "hello grace". ✅ done.
2. **OAuth2 flow** — `grace oauth login` command, loopback redirect handler, tokens in Keychain.
3. **IMAP bootstrap** — connect, fetch last 500 inbox messages, write to SQLite, render basic list in TUI.
4. **Real-time IDLE + SSE** — daemon holds IDLE, publishes on new message, TUI updates without refresh.
5. **Mutations** — archive / mark read / star, optimistic UI, daemon reconciles with IMAP.
6. **Compose + send** — basic form, SMTP, optimistic send state.
7. **Triage mode + command palette** — the two cornerstone UX features.
8. **Claude summarize / draft / NL-select** — AI actions.

Each step produces a video-worthy demo. Ship milestone by milestone; don't batch.

## Success criteria for v1

- Daily-driver-worthy for a single Gmail user.
- Reading email feels faster than the web client.
- At least one creative feature (triage / palette / AI) is something I catch myself missing when I'm back in Gmail web.
- No crashes in a week of personal use.

## Reference docs

- `README.md` — how to run.
- `../../oss/opencode/packages/opencode/specs/` — for pattern reference.
- `~/.claude/projects/-Users-yash-Developer-oss-opentui/memory/` — Claude's project memory; has notes on opentui gaps, Replicache vs Zero status, and this stack's rationale.
