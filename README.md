# grace

A terminal email client for Gmail.

## Shape

Two processes, one machine:

- `apps/server` — long-lived daemon. Holds IMAP IDLE connections, SQLite cache, OAuth tokens. Exposes an Elysia HTTP API on loopback.
- `apps/tui` — opentui + SolidJS frontend. Attaches to the daemon over SSE; any number of TUI windows can run concurrently.

Packages:

- `@grace/api` — Elysia app with routes, services, event bus. Eden Treaty for end-to-end types.
- `@grace/env` — typed env with Zod.
- `@grace/config` — shared tsconfig.

## Run (once deps land)

```
bun install
bun run dev:server   # daemon
bun run dev:tui      # in another pane
```

## Reference

- `../../oss/opencode` — architecture patterns (daemon + TUI split, command palette, SSE bus)
- `../orys` — Bun workspace + Elysia + Turbo layout
