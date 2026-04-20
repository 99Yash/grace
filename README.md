# grace

A terminal email client for Gmail. Keyboard-first, instant, built around
triage instead of reading.

Two processes on one machine: a long-lived daemon holds the IMAP IDLE
connection, SQLite cache, and OAuth tokens. A thin TUI (opentui + Solid)
attaches to it over SSE. Any number of TUI windows can connect to the
same daemon concurrently.

> Single-user, single-Gmail-account, macOS. Not multi-account. Not
> multi-provider. See `prd.md` for scope.

## Quick start

New install? See **[SETUP.md](./SETUP.md)** — walks through Google Cloud
Console, `.env`, and sign-in.

Already set up:

```bash
bun install
bun run oauth:login      # one-time (weekly while GCP app is in Testing mode)
bun run dev:server       # pane 1 — daemon + IDLE
bun run dev:tui          # pane 2 — TUI
```

Health check any time: `bun run doctor`.

## What works

- **Mail flow.** Real-time push via IMAP IDLE (sub-second latency from
  Gmail to the TUI). 1000-message local window per folder, backfilled
  in the background with a live progress pill.
- **Reader.** Plain-text default with HTML-to-text fallback for
  marketing mail; `v` for rich render via `w3m -dump`; `V` for browser
  eject. Hybrid storage — text + metadata in SQLite, HTML and raw `.eml`
  on disk at `~/.grace/bodies/`.
- **Mutations.** `m` read · `s` star · `e` archive · `#` trash · `l`
  label — all optimistic, with server-authoritative rollback on error.
  Labels round-trip through `X-GM-LABELS` STORE.
- **Search.** `/` → two-phase: instant SQLite LIKE hits (`L` badge)
  stream first, Gmail `X-GM-RAW` remote hits (`R` badge) stream in
  after. Enter on a remote-only hit imports it before opening.
- **Compose.** `c` → full-screen overlay with To / Cc / Bcc / Attach /
  Subject / Body. `alt+c` / `alt+b` / `alt+a` reveal the hidden rows.
  `shift+r` from the reader pre-fills a threaded reply with
  `In-Reply-To` / `References` headers.
- **Triage.** `shift+t` → fullscreen one-message-at-a-time. `space`
  archive + next, `a` archive, `r` reply, `j`/`k` nav.
- **Sidebar.** Tab toggles focus. Folder switch lazy-bootstraps +
  backfills; up to 4 concurrent per-folder IDLE supervisors keep
  activated folders live.
- **Resilience.** IDLE reconnect with exponential backoff (1s → 60s
  cap), fresh access token per attempt. `idle.status` bus events
  expose state to clients.

## Keybinds

**Global:** `/` search · `c` compose · `:` palette · `?` help · `r`
refresh · `shift+t` triage · `ctrl+c` quit
**Nav:** `j`/`k` down/up · `g`/`G` top/bottom · `Tab` focus sidebar ·
`Enter` open · `Esc` close
**Mail:** `m` read · `s` star · `e` archive · `#` trash · `l` label
**Reader:** `v` w3m · `V` browser · `shift+r` reply · `t` plain-text ·
`z` toggle quotes
**Triage:** `space` archive+next · `a` archive · `r` reply
**Compose:** `ctrl+s`/`ctrl+return` send · `alt+c`/`alt+b`/`alt+a`
toggle Cc/Bcc/Attach · `Tab` next field

Full list inside the app — press `?`.

## Architecture

```
┌──────────────────┐   HTTP + SSE    ┌───────────────────────────────┐
│ TUI              │ ───────────────→│ Daemon (Elysia + Bun)         │
│ opentui + Solid  │  loopback only  │   SQLite via Drizzle          │
│ Eden Treaty      │                 │   IMAP IDLE (imapflow)        │
└──────────────────┘                 │   SMTP (nodemailer)           │
        ↑                            │   OAuth2 + macOS Keychain     │
        │ any # of TUIs              └───────────────────────────────┘
        └── events ── Bus.publish('mail.received' | 'mail.updated' …)
```

`prd.md` has the why. `plan.md` has what's next. `progress.md` has what
shipped and when.

## Scripts

| Script                         | What it does                                     |
| ------------------------------ | ------------------------------------------------ |
| `bun run dev:server`           | Run daemon + IMAP IDLE (turbo-watched)           |
| `bun run dev:tui`              | Run TUI (connects to daemon on 127.0.0.1:3535)   |
| `bun run oauth:login`          | Browser OAuth flow; stores tokens in Keychain    |
| `bun run oauth:logout [email]` | Clear Keychain entry; defaults to active account |
| `bun run doctor`               | Env + keychain + db + IMAP health check          |
| `bun run smoke:imap`           | Standalone IMAP handshake                        |
| `bun run smoke:bootstrap`      | Pull N headers into SQLite                       |
| `bun run check-types`          | Project-wide `tsc -b`                            |

## Layout

```
grace/
├── apps/
│   ├── server/  — Elysia daemon + CLIs (doctor, oauth, smoke)
│   └── tui/     — opentui+Solid client
├── packages/
│   ├── api/     — routes + bus + imap-action + folder-manager singletons
│   ├── auth/    — OAuth2 (loopback+PKCE) + keychain + refresh
│   ├── db/      — Drizzle schema + bun:sqlite
│   ├── mail/    — IMAP client, bootstrap, IDLE supervisor, backfill,
│   │              fetch-body, mutations, list-folders, SMTP send
│   ├── env/     — zod-validated env
│   └── config/  — shared tsconfig base
└── prd.md · plan.md · progress.md · SETUP.md
```

## Data locations

- **Tokens.** macOS Keychain under service `grace`. Inspect with
  Keychain Access.app or `security find-generic-password -s grace -w`.
- **Database.** `~/.grace/grace.db` (SQLite; `.db-journal` during writes).
- **Bodies.** `~/.grace/bodies/<gmMsgid>.{html,eml}`.
- **Drafts.** `~/.grace/drafts/current.jsonl` (append-only).

`bun run oauth:logout` clears the Keychain entry but leaves `~/.grace/`
intact — re-signing as the same account reuses the cache. Wipe the
directory manually for a full reset.
