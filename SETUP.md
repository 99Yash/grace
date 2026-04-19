# Setting up grace

Fresh-install walkthrough. Should take ~10 minutes the first time.

## 1. Prerequisites

- **macOS.** grace stores OAuth tokens in the macOS Keychain and hasn't
  been tested on other platforms. PRs welcome if you want to port.
- **Bun 1.3+.** `curl -fsSL https://bun.sh/install | bash` or
  `brew install oven-sh/bun/bun`. Verify with `bun --version`.
- **A modern terminal that forwards Option as Meta.** Ghostty, iTerm2,
  WezTerm, and Kitty all work. macOS Terminal.app needs
  `Use Option as Meta Key` enabled in profile settings.
- **Optional: `w3m`.** Gives you `v` → rich HTML render in the reader.
  `brew install w3m`. Without it, `v` shows a toast and `V` (browser
  eject) is the fallback.

## 2. Google Cloud Console — create an OAuth client

grace signs you in with your own Google Cloud OAuth credentials. You're
the only user, so this is a one-time setup.

1. Open <https://console.cloud.google.com/> and create (or pick) a
   project. Name it anything; `grace` works.
2. Enable the **Gmail API** for the project:
   `APIs & Services` → `Library` → search "Gmail API" → `Enable`.
3. Configure the OAuth consent screen:
   `APIs & Services` → `OAuth consent screen` → `External` → `Create`.
   - App name: `grace`
   - User support email + developer contact email: your email
   - Scopes: skip (the app requests them at sign-in time)
   - Test users: add your Gmail address
   - Save + back to dashboard
4. Create the OAuth client:
   `APIs & Services` → `Credentials` → `Create Credentials` →
   `OAuth client ID` → Application type **Desktop app** → name `grace`
   → `Create`.
5. Copy the **Client ID** and **Client secret** from the dialog (or
   the credentials list afterward). You'll paste these into `.env`.

> **Testing vs Published.** An app in Testing mode issues refresh
> tokens that expire after **7 days**. You'll need to re-run
> `bun run oauth:login` weekly until you publish. For a personal tool,
> weekly re-auth is usually fine; publish if it gets annoying.

## 3. Clone and install

```bash
git clone <repo-url> grace
cd grace
bun install
```

The install step fetches Bun workspace deps + runs Turbo's postinstall.
First run takes ~30 seconds; subsequent installs are cached.

## 4. Configure `.env`

```bash
cp .env.example .env
```

Open `.env` and paste the credentials from step 2:

```
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
```

`GRACE_HOST`, `GRACE_PORT`, `GRACE_DATA_DIR` are optional overrides
(defaults: `127.0.0.1`, `3535`, `~/.grace`).

## 5. Sign in

```bash
bun run oauth:login
```

This:
1. Opens a loopback HTTP listener on a random localhost port.
2. Opens your browser to Google's consent screen (PKCE + `state`).
3. Receives the code, exchanges it for tokens, and stores them in the
   macOS Keychain under service `grace`.

You should see `✓ Signed in as <your@email>`. The scope grace requests
is `https://mail.google.com/` (full IMAP/SMTP access) — it's Gmail's
required scope for XOAUTH2 and it replaces the finer-grained
`gmail.modify` / `gmail.send` scopes.

Re-running `oauth:login` refreshes the stored tokens; you don't need
to log out first.

## 6. Verify

```bash
bun run doctor
```

You should see passes in every section except `daemon` (expected — the
daemon isn't running yet) and possibly `capabilities` (if `w3m` isn't
installed). A real failure looks like a red `✗` on env, keychain, or
imap. Doctor exits non-zero on any `✗`.

Example sections doctor checks:
- `env` — `.env` present, `GOOGLE_OAUTH_*` set,
  `ANTHROPIC_API_KEY` (warn if missing; required for M11 Claude
  features only).
- `keychain` — active account + refresh token present, access token
  expiry band, scope contains `https://mail.google.com/`.
- `database` — `~/.grace/grace.db` size + row counts.
- `capabilities` — `w3m` binary probe.
- `daemon` — HTTP probe against `/api/health`.
- `imap` — live token refresh + handshake + mailbox list.

## 7. Run it

Two panes:

```bash
bun run dev:server   # pane 1
bun run dev:tui      # pane 2
```

First boot bootstraps the last 500 INBOX headers (~3s) then kicks off a
background backfill to 1000 — you'll see `done/target syncing` in the
header. After that, new mail pushes in under a second via IDLE.

## 8. Everyday commands

| Command | What it does |
|---|---|
| `bun run dev:server` | Foreground daemon — owns IDLE + mutations |
| `bun run dev:tui` | Foreground TUI — any number can attach |
| `bun run doctor` | Sanity check — run first when something's off |
| `bun run oauth:login` | Re-auth after the 7-day Testing-mode expiry |
| `bun run oauth:logout` | Clear the active account's Keychain tokens |
| `bun run oauth:logout user@example.com` | Clear a specific account (forward-compat) |

Inside the TUI:
- `?` — keybinds dialog (authoritative — don't memorize from this file)
- `:` — command palette

## Troubleshooting

**"GOOGLE_OAUTH_CLIENT_ID missing" on startup.** `.env` isn't being
loaded. Check the file exists at the repo root (not inside `apps/`),
has no `export` prefix, and isn't named `.env.local` or `.env.dev`.

**"Too many simultaneous connections" from Gmail.** You have more than
~13 IMAP sockets open (grace's budget is typically 6-8; straggler dev
daemons eat the rest). List them:

```bash
ps -eo pid,etime,command | grep -E 'turbo.*-F server|apps/server/src/index' | grep -v grep
```

Kill the PIDs. grace 0.1 guards against double-daemon at boot (probes
`/api/health` and exits if one's already running), so this usually
only happens after a dirty reload.

**IDLE drops and never reconnects.** Shouldn't happen — the supervisor
in `packages/mail/idle-supervisor.ts` handles close events with
exponential backoff (1s → 60s cap). If you see it stuck, tail the
daemon log for `idle:` lines and file an issue with the repro. You can
force a reconnect by restarting the daemon.

**Messages say "(no plain-text part)" even though the email has
content.** Hit `V` to open in your browser. The server tries
`html-to-text` as a fallback, but some marketing HTML is hostile
enough that the derived text is still empty.

**Refresh token expired mid-session.** The daemon auto-refreshes
access tokens near expiry; refresh tokens only expire after 7 days in
Testing mode. Re-run `bun run oauth:login` and restart the daemon.

**Want to start clean.** `bun run oauth:logout && rm -rf ~/.grace` —
the next `oauth:login` + `dev:server` will rebootstrap from scratch.

## Next

Read `prd.md` for product intent, `plan.md` for what's coming, and
`progress.md` for a dated log of what shipped.
