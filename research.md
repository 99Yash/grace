# Grace research notes

This is **scaffolding**, not permanent documentation. Everything here is true as of writing (April 2026) but will rot. Treat it as a primer — when anything important is needed at execution time, re-verify by reading the current source.

## Reference codebases

Both cloned locally. Paths here are absolute so agents can navigate directly.

### opentui (`/Users/yash/Developer/oss/opentui`)

The TUI framework. Zig core + TypeScript bindings, Yoga flexbox layout, retained-mode rendering.

Key files to read when building UI:

- `packages/core/src/renderables/Input.ts` — single-line input
- `packages/core/src/renderables/Textarea.ts` — multi-line input + default keybindings list (see gotcha below)
- `packages/core/src/renderables/ScrollBox.ts` — scrollable viewport; use for inbox list
- `packages/core/src/renderables/Select.ts` — dropdown/list with j/k nav; use for folder list
- `packages/core/src/renderables/TextTable.ts` — tabular data with column widths
- `packages/core/src/renderables/Markdown.ts` — markdown rendering
- `packages/core/src/lib/parse.keypress.ts` — terminal key parser
- `packages/core/src/lib/parse.keypress-kitty.ts` — Kitty keyboard protocol parser
- `packages/core/src/examples/` — 62 runnable demos; best way to learn a specific primitive
- `packages/solid/README.md` — setup instructions for @opentui/solid (preload, jsxImportSource)
- `packages/solid/examples/components/textarea-minimal-demo.tsx` — canonical Solid+opentui example with custom keybindings

### opencode (`/Users/yash/Developer/oss/opencode`)

The reference architecture for grace — daemon + TUI with SSE bus, SolidJS reactive store, command palette. **Copy patterns from here when unsure.**

Key files:

- `packages/opencode/src/cli/cmd/serve.ts` — daemon entrypoint
- `packages/opencode/src/server/server.ts` — Hono app, OpenAPI generation (we use Elysia+Eden instead)
- `packages/opencode/src/server/routes/instance/event.ts` — SSE endpoint with heartbeat
- `packages/opencode/src/bus/index.ts` — Effect PubSub with typed channels
- `packages/opencode/src/storage/schema.ts` — Drizzle schema (Account, Session, Message, Part, Todo, Permission, Workspace)
- `packages/opencode/src/storage/storage.ts` — JSON blob layer alongside SQLite
- `packages/opencode/src/auth/index.ts` — auth storage at `~/.local/share/opencode/auth.json` with `0o600` (we diverge to macOS Keychain)
- `packages/opencode/src/cli/cmd/tui/app.tsx` — TUI entrypoint with provider stack
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx` — reactive Solid store mirroring server state via SSE
- `packages/opencode/src/cli/cmd/tui/context/keybind.tsx` — keybind parsing + leader-key chord mode
- `packages/opencode/src/cli/cmd/tui/component/dialog-command.tsx` — command palette (single registry for commands + keybinds)
- `packages/opencode/bunfig.toml` — shows `preload = ["@opentui/solid/preload"]`
- `packages/opencode/tsconfig.json` — JSX config (`jsx: preserve`, `jsxImportSource: @opentui/solid`)

## Stack decisions

### Elysia + Eden, not Hono + codegen

Opencode uses Hono + `hono-openapi` + codegenned SDK. We use Elysia + Eden Treaty — Eden gives end-to-end types via a plain TypeScript type import (`type App = typeof app`), no build step. One less thing to break. Matches the orys pattern.

### SolidJS, not React

`@opentui/solid` is what opencode uses. Fine-grained reactivity, no reconciler overhead. Store changes propagate without re-rendering the whole tree.

### Bun + SQLite (Drizzle), not Replicache

Replicache works in Bun (via `@rocicorp/zero-sqlite3` store provider), but its value — multi-client sync against a remote server — doesn't apply to our shape (one daemon + one-or-more local TUIs on the same machine). The opencode pattern (mutation POST → SQLite → bus → SSE) is simpler and covers the same ground.

Revisit only if we ever want multi-device sync with a shared cloud daemon.

### macOS Keychain for credentials, not plaintext

Opencode stores API keys in `~/.local/share/opencode/auth.json` with `0o600`. For email OAuth tokens we use `keytar` (macOS Keychain) — Gmail access is higher-value than a Claude API key; a compromised file = silent read of every email ever.

## Gmail IMAP notes

- **IDs:** use `X-GM-MSGID` as the stable primary key. Message UIDs change on move/copy. Also store `X-GM-THRID` for conversation threading.
- **Labels, not folders:** Gmail exposes labels as IMAP folders. A single message can appear in multiple "folders". "Archive" = remove the `INBOX` label.
- **Search:** `X-GM-RAW` accepts Gmail's native query syntax (`from:x is:unread older_than:30d`). Use this for anything complex — don't reinvent.
- **IDLE timeout:** Gmail drops IDLE connections after ~29 min. `imapflow` handles reconnect with backoff.
- **Concurrent connections:** Gmail allows 15 simultaneous IMAP connections per account. One IDLE per watched folder + one for actions = plenty of headroom.
- **Delta sync:** Gmail supports CONDSTORE/QRESYNC (RFC 7162). Store `HIGHESTMODSEQ` per folder; ask for changes since on reconnect — one round trip, no full rescan.
- **Docs:** <https://developers.google.com/gmail/imap/imap-extensions>

## OAuth2 notes

- **Client type:** Desktop app. Loopback redirect + PKCE. Bind random port on `127.0.0.1`, open browser, receive code on `/callback`, exchange for tokens.
- **Scopes:** `openid` + `email` + **`https://mail.google.com/`**. The `gmail.modify`/`gmail.send` scopes do NOT work for IMAP XOAUTH2 — Google requires the full-access `mail.google.com/` scope for IMAP + SMTP. Error you'll see: `oauthError: { scope: "https://mail.google.com/" }`.
- **Consent screen scopes must match:** GCP Console → OAuth consent screen → Data access → add `https://mail.google.com/` to the scope list, or Google rejects the auth request even if you ask for it.
- **Test users:** while in Testing mode, add your email to the Test users list (OAuth consent screen → Audience tab in the new UI) or you'll get `Error 403: access_denied`.
- **Refresh tokens expire after 7 days in Testing mode.** Publish the app (unverified-with-warning) or re-run `oauth:login` weekly.
- **Verification:** `mail.google.com/` is a "restricted scope". Distribution requires CASA third-party security assessment. Personal use in Testing: zero hoops.
- **Refresh:** `google-auth-library`'s `OAuth2Client.refreshAccessToken()` is the canonical call. `@grace/auth`'s `getFreshAccessToken()` wraps it with keychain load/save + 60s safety window.

## IMAP IDLE notes

- **imapflow auto-IDLE:** after `mailboxOpen()` (no lock), imapflow auto-enters IDLE when idle and auto-exits for commands. No manual `idle()` call needed.
- **Listener order matters:** attach `client.on("exists", …)` BEFORE `mailboxOpen()`. If attached after, the first events can be delayed or missed — looks like Gmail is "laggy" but it's actually our race. **This was the cause of grace's perceived 1-2min latency during M4 dev.**
- **`qresync: true`** on the ImapFlow constructor enables CONDSTORE/QRESYNC — doesn't change IDLE behavior but enables efficient delta resume.
- **Debug:** pass `logger: { debug, info, warn, error }` to `ImapFlow` options to see protocol chatter. `@grace/mail`'s `createImapClient({debug: true})` turns this on. Gated behind `GRACE_IMAP_DEBUG=1` env var in the daemon.
- **Listener shape:** `client.on("exists", ({ path, count, prevCount }) => …)`. `path` equals mailbox path; `count - prevCount` = new arrivals.
- **Gmail IDLE is actually fast when set up right** — sub-second push, despite community folklore. The community's "Gmail IDLE is laggy" claim is usually a listener-order or reconnect issue, not Gmail.

## SSE in Bun/opentui context

- **`EventSource` is NOT reliably available in the @opentui/solid runtime context** as of v0.1.100. It's in Bun globally, but something in the preload pipeline shadows/removes it. Bun issue or preload side effect — don't count on it.
- **Roll SSE on top of `fetch`** — stream the response body, parse `event:` / `data:` frames manually. `apps/tui/src/sse.ts` is ~40 lines and gives you reconnect-with-backoff for free. Use this, not `EventSource`.

## Gotchas (verified while scaffolding)

- **opentui option+backspace:** `packages/core/src/renderables/Textarea.ts` defaults do not bind `meta+backspace`. Must pass `{ name: "backspace", meta: true, action: "delete-word-backward" }` in `keyBindings` for every Input/Textarea.
- **opentui Bun setup:** `bunfig.toml` with `preload = ["@opentui/solid/preload"]`. Without it, `jsxDEV` import fails.
- **Turbo + TUI:** turbo pipes stdout and strips the TTY, breaking opentui's alt-screen mode. `dev:tui` bypasses turbo.
- **Warp terminal:** swallows Option as modifier by default. Settings → Features → "Use Option key as Alt" = on. Other terminals (Ghostty/iTerm2/WezTerm/Kitty) are fine out of the box.
- **`.env` + `bun run --cwd`:** Bun only auto-loads `.env` from cwd. `apps/server/package.json` uses `bun --env-file=../../.env` so turbo-spawned processes find the root `.env`.
- **Scrollbox flexbox:** `<scrollbox>` inside a flex column with siblings needs `minHeight={0}` or it pushes parent layout and clobbers sibling rows.
- **Workspace deps:** every cross-package import must be declared in that package's `package.json` `dependencies`, or Bun throws `Cannot find package 'X'`. Applies to both workspace packages and npm packages. `bun install` re-links after the change.

## When to delete / revisit this file

Delete sections when they go stale. Specifically:

- opencode file paths drift fast — their repo is active (commit history is dense). Re-verify before quoting.
- opentui's option+backspace gap may get fixed upstream — check before adding workarounds.
- Replicache vs Zero: Zero will probably ship Node client support eventually. Revisit the "no Replicache" decision then.
- Gmail IMAP extensions are stable but not eternal.

Rule of thumb: at every milestone boundary, read this file and delete what's obsolete.
