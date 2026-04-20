# grace

Terminal Gmail client: Bun daemon (Elysia + SQLite + IMAP IDLE) + opentui/Solid TUI over SSE on 127.0.0.1:3535.

## Commands

- Install: `bun install` (package manager is `bun`, not npm/pnpm)
- Dev: `bun run dev:server` and `bun run dev:tui` in separate panes
- Typecheck: `bun run check-types` (turbo-orchestrated `tsc -b`)
- Lint/format: `bun run check` (oxlint + oxfmt)
- Health check: `bun run doctor`

## Deeper docs

- `README.md` — architecture, keybinds, data locations
- `SETUP.md` — fresh-install walkthrough
- `prd.md` — scope and non-goals
- `plan.md` — what's next
- `progress.md` — what shipped

## Plan mode

- Make the plan extremely concise. Sacrifice grammar for concision.
- End every plan with a list of unresolved questions, if any.
