#!/bin/bash
set -e
if [ -z "$1" ]; then
  echo "Usage: $0 <iterations> [prompt]"
  exit 1
fi

PROMPT="${2:-Advance the grace milestone punch list. Follow the Ralph protocol in your system prompt.}"

BOLD=$'\033[1m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; RESET=$'\033[0m'

read -r -d '' SYSTEM_PROMPT <<'EOF' || true
RALPH LOOP — you are one iteration of a shell loop (`ralph.sh`). Each
iteration is a fresh Claude Code session with NO memory of prior runs. All
continuity lives in repo files and git history. Read before you write.

Source of truth: `plan.md` (milestone status table + per-milestone
deferred lists). Cross-refs: `progress.md` (dated log of what shipped),
`prd.md` (product intent), `refresh.md` (UI primitives plan — R1-R13
and R15 are done; only R14 remains), `uiux.md` (rough-edge catalog).

Remaining punch list (pick from the lowest unblocked item each run):

  M6.label-move     — `l` mutation: label picker + imapflow `client.exec`
                      X-GM-LABELS STORE, or moves between label folders.
  M7.per-folder-idle — folder manager module with connection lifecycle;
                      do M12.idle-reconnect first so you can reuse the
                      backoff/reconnect helper. Gmail 15-conn cap is real.
  M7.label-pills    — cosmetic row decoration; data already in
                      messages.labels.
  M8.reply-prefill  — `R` in reader → compose pre-filled with
                      In-Reply-To / References + quoted body.
  M8.cc-bcc         — Cc / Bcc fields in compose overlay + send route.
  M8.attachments    — multipart attachments via nodemailer.
  M9.triage         — fullscreen one-at-a-time view; space = next+archive,
                      `a` archive, `r` reply. Inspired by Spark/Superhuman.
  M11.summarize     — Claude summarize selected thread. NOTE: `s` already
                      means star; pick a leader chord (e.g. `<leader>s`)
                      or a different key, and update help + registry.
                      Needs ANTHROPIC_API_KEY in .env.
  M11.draft         — Claude draft reply from thread; pre-fills compose.
  M11.nl-select     — `.` → NL prompt → Claude → X-GM-RAW → bulk action.
  M12.idle-reconnect — exponential backoff on imapflow `close` event.
  M12.network-recovery — detect network drop/restore; reconnect cleanly.
  M12.doctor        — `grace doctor` CLI: env / keychain / db / imap status.
  M12.oauth-logout  — `grace oauth logout` clears keychain entries.
  M12.docs          — README + SETUP.md for a fresh install.
  R14.virtualize    — manual viewport buffer for message list.
                      Only pick if a real >500-msg backlog stutters.

Protocol — follow every iteration:

  1. Read `plan.md` (milestone table + the partial/deferred sections
     for M6, M7, M8). Read `progress.md` for what already shipped.
  2. Run `git log --oneline -20` to see what prior iterations landed.
     Trust git, not your assumptions.
  3. Pick ONE unblocked item from the punch list above. Prefer the
     topmost remaining item. Respect blocking relationships
     (e.g. M7.per-folder-idle is blocked on M12.idle-reconnect).
  4. Implement exactly that item. Honor the acceptance criteria
     implied by plan.md for its milestone. No drive-by refactors, no
     scope creep. If the item is bigger than one session, split it in
     `plan.md` and do the first half.
  5. Run `bun run check-types`. Must pass. Fix failures;
     broken types are not allowed.
  6. Update `plan.md`: flip the milestone row to ✅ when its whole
     deferred list clears, else trim the relevant "Deferred" bullet
     and keep the 🟡 partial marker honest. Append a dated bullet to
     `progress.md` describing what shipped (follow the existing
     voice — terse, technical, why over what).
  7. If every milestone in plan.md's status table is ✅ AND the smoke
     checklist below passes, emit exactly
     `<promise>COMPLETE</promise>` as your final output line.
     Otherwise end naturally — the loop continues.

Smoke checklist (non-negotiable — never regress):

  - Inbox loads; folder sidebar populates; IDLE pushes new mail.
  - `j`/`k` nav; Enter opens reader; Esc closes.
  - Compose (`c`) opens, sends, closes. Error path surfaces in UI.
  - Search (`/`) opens, local + remote hits stream; Enter on remote
     imports + opens.
  - Mutations `m`, `s`, `e`, `#` round-trip through SSE and clear the
     pending overlay.
  - Folder switching from sidebar still lazy-bootstraps + backfills.
  - `:` palette opens; `?` help opens; theme picker works.

Hard rules:

  - One item per iteration. No batching, no "while I'm here."
  - Never regress a previously shipped milestone. Smoke checklist is
     non-negotiable.
  - `apps/tui/src/index.tsx` stays lean (it's ~220 lines after the
     refresh — don't reinflate it). New code lives in components/,
     ui/, or packages/.
  - If an item needs a human decision (keybind collision resolution,
     UX trade-off, Anthropic model pick, etc.), append the question +
     your recommendation to `refresh-decisions.md` and end the
     iteration. Do NOT emit COMPLETE.
  - If you truly cannot make progress (blocker, ambiguity, missing
     dep, missing ANTHROPIC_API_KEY for M11), append a dated note to
     `refresh-blockers.md` explaining why and what's needed, end the
     iteration.
  - Prefer porting patterns from `/Users/yash/Developer/oss/opencode`
     (opentui+Solid peer app) over inventing.
  - Do not touch `prd.md` or `refresh.md` unless the item explicitly
     requires it. `plan.md` + `progress.md` are where you record
     progress.

Permissions are pre-approved (`--permission-mode bypassPermissions`).
Use that trust carefully — destructive ops (git reset --hard, force
push, rm -rf) are still off-limits unless an item explicitly calls
for them.
EOF

# jq filter: render stream-json in Claude-Code style
format_stream='
def orange: "\u001b[38;5;208m";
def dim:    "\u001b[2m";
def red:    "\u001b[31m";
def bold:   "\u001b[1m";
def reset:  "\u001b[0m";

# Summarize a tool_use input the way the TUI does: one key per known tool.
def fmt_input(name; input):
  ( if   name == "Bash"      then input.command // ""
    elif name == "Read"      then input.file_path // ""
    elif name == "Write"     then "\(input.file_path // "") (\((input.content // "") | length) chars)"
    elif name == "Edit"      then input.file_path // ""
    elif name == "MultiEdit" then "\(input.file_path // "") (\((input.edits // []) | length) edits)"
    elif name == "Glob"      then input.pattern // ""
    elif name == "Grep"      then "\"\(input.pattern // "")\"\(if input.path then " in \(input.path)" else "" end)"
    elif name == "LS"        then input.path // ""
    elif name == "WebFetch"  then input.url // ""
    elif name == "WebSearch" then "\"\(input.query // "")\""
    elif name == "Task"      then input.description // ""
    elif name == "TodoWrite" then "\((input.todos // []) | length) items"
    else (input | tostring) end )
  | if length > 140 then .[0:137] + "..." else . end;

# Indent and truncate a tool_result block, one line per output row.
def fmt_result(c):
  ( if (c | type) == "string" then c
    else (c | map(.text // "") | join("\n")) end )
  | split("\n")
  | (if length > 6 then .[0:6] + ["… (\(length - 6) more lines)"] else . end)
  | map("  " + dim + "⎿ " + . + reset)
  | join("\n");

if .type == "system" and .subtype == "init" then
  bold + "● Session " + reset + (.session_id // "?")[0:8]
  + dim + "  model=" + (.model // "?")
  + "  cwd=" + (.cwd // "?") + reset + "\n\n"

elif .type == "assistant" then
  .message.content[]? |
  if   .type == "text"     then .text + "\n\n"
  elif .type == "thinking" then
        dim + "✻ Thinking…\n"
        + (.thinking | split("\n") | map("  " + .) | join("\n"))
        + reset + "\n\n"
  elif .type == "tool_use" then
        orange + "● " + reset + bold + .name + reset
        + "(" + dim + fmt_input(.name; .input) + reset + ")\n"
  else empty end

elif .type == "user" then
  .message.content[]? |
  if .type == "tool_result" then
    ( if .is_error == true then
        "  " + red + "⎿ error: " + reset
        + ( if (.content|type)=="string" then .content
            else (.content|tostring) end | .[0:300] ) + "\n\n"
      else fmt_result(.content) + "\n\n" end )
  else empty end

elif .type == "result" then
  "\n" + bold + "● Done" + reset
  + dim + "  duration=" + ((.duration_ms // 0) | tostring) + "ms"
  + "  turns=" + ((.num_turns // 0) | tostring)
  + "  cost=$" + ((.total_cost_usd // 0) | tostring) + reset + "\n\n"

else empty end
| gsub("\n"; "\r\n")
'

final_result='select(.type == "result").result // empty'

for ((i=1; i<=$1; i++)); do
  printf '%s━━━ Ralph iteration %d/%d ━━━%s\r\n\n' "$BOLD$CYAN" "$i" "$1" "$RESET"
  tmpfile=$(mktemp)
  trap "rm -f $tmpfile" EXIT

  claude \
    --verbose \
    --print \
    --output-format stream-json \
    --permission-mode bypassPermissions \
    --append-system-prompt "$SYSTEM_PROMPT" \
    "$PROMPT" \
  | grep --line-buffered '^{' \
  | tee "$tmpfile" \
  | jq --unbuffered -rj "$format_stream"

  result=$(jq -r "$final_result" "$tmpfile")
  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    printf '%s%sRalph complete after %d iterations.%s\n' "$GREEN" "$BOLD" "$i" "$RESET"
    exit 0
  fi
done
