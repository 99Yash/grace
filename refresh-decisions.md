# Refresh decisions

Taste calls that outlive one iteration. Recorded here so future Ralph runs don't
re-derive them.

## 2026-04-19 — Proto A: theme tokens (settled during R2)

**Shape.** Flat token object, no nested namespaces. 21 named tokens total:
surfaces (6), text (8), primary family (3), semantic (5).

**Token names.** See `apps/tui/src/theme/tokens.ts`. Ordered from the canvas
outward: `background` (chrome) → `surface` (sidebar/folder header) →
`surfaceAlt` (elevated headers) → `field` (inputs, dividers) → `selection`
(active row). Text scale runs `text` (emphasis) → `textBright` → `textBody` →
`textMuted` → `textSubtle` → `textFaint` → `textGhost`, plus `textRead` for
the dim-but-not-ghosted "already-read subject" case.

**Ship one theme first.** R2 lands a single polished dark theme
(`theme/themes/dark.ts`). Light theme + picker deferred to R8 — cheaper to
validate token shape against one theme than to rework two in parallel.

**File format.** Plain `.ts` (typed via `Theme` interface), not `.json`. JSON
was in the plan so user themes could drop in a config dir eventually; a TS
object is strictly superset (can add a `loadUserTheme(json)` parser later
without changing shape). Zero overhead, full type safety.

**Contrast we kept.** Unread blue (`#4da3ff`) stays separate from selection
blue (`#1f3a5f` bg) — the PRD called out that collision as a must-fix, but
in practice they were already distinct. Verified by reading MessageRow with
a selected unread row: blue dot on dark-blue bg is still legible.

## 2026-04-19 — R4: leader key default

**Leader = `ctrl+b`.** The PRD pitched `space`, but a bare `space` would
activate leader every time the user types a space in compose/search (global
`useKeyboard` fires even with an input focused). `ctrl+b` is tmux-idiomatic,
free of collisions with existing bindings (`/` search, `c` compose, `r`
refresh, `m/s/e/#` mail actions, `v/V/t` reader, `tab` sidebar, `j/k/g/G`
nav), and shows up as `ctrl+b` in UI via `kb.print()`. Configurable via
`KeybindProvider` overrides when config-file loading lands.

No `<leader>`-prefixed bindings exist yet — R4 is wiring only. First
leader-chord bindings will be set in R11 (first batch of registered
commands).

## 2026-04-19 — Proto B: command palette UX (settled during R10)

**Entrypoint = `:`** (parsed as `:,shift+;` so both the literal char and the
shift-semicolon chord match). Lives next to `/` for search — both single-key,
both reserved for overlays, both vim-idiomatic. Leader+`p` was the opencode
convention, but stealing a whole chord slot for what is itself an overlay
opener felt wasteful when a free single char was available.

**Suggestions pre-type = yes.** Matches opencode. An empty palette that says
"type to filter…" and nothing else looks broken. When the filter is empty,
suggested commands render under a "Suggested" category; once the user types,
the full visible list scores through the fuzzy filter. No duplicates: the
palette swaps between `suggested` and `visible` based on filter emptiness
rather than concatenating them (DialogSelect would hit key collisions if we
did). If no command has `suggested: true`, the full list renders from
the start — no empty state.

**First 10 commands for R11.** Confirmed unchanged: compose, archive, star,
toggle-read, trash, switch-folder, refresh, search, help, themes. R11
registers these — R10 is wiring only.
