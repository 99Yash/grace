#!/bin/bash
set -e
if [ -z "$1" ]; then
  echo "Usage: $0 <iterations> [prompt]"
  exit 1
fi

PROMPT="${2:-Advance the grace UI refresh. Follow the Ralph protocol in your system prompt.}"

BOLD=$'\033[1m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; RESET=$'\033[0m'

read -r -d '' SYSTEM_PROMPT <<'EOF' || true
RALPH LOOP — you are one iteration of a shell loop (`ralph.sh`). Each
iteration is a fresh Claude Code session with NO memory of prior runs. All
continuity lives in repo files and git history. Read before you write.

Source of truth: `refresh.md` (the 7-phase plan). Cross-refs: `plan.md`
(milestones), `progress.md` (shipped), `prd.md` (product intent),
`uiux.md` (rough-edge catalog).

Protocol — follow every iteration:

  1. Read `refresh.md`, especially Phase 5 (ticket table R1-R15) and
     Phase 7 (QA checklist). Read `progress.md` for context on what
     already shipped.
  2. Run `git log --oneline -20` to see what prior iterations landed.
     Trust git, not your assumptions.
  3. Pick ONE unblocked ticket. Prefer the lowest ID with remaining
     work. Respect the blocking relationships in Phase 5.
  4. Implement exactly that ticket. Honor its acceptance criteria. No
     drive-by refactors, no scope creep. If the ticket is bigger than
     one session, split it in `refresh.md` and do the first half.
  5. Run `bun run check-types`. Must pass. Fix failures;
     broken types are not allowed.
  6. Mark the ticket ✅ in `refresh.md`'s Phase 5 table.
  7. If ALL tickets R1-R15 in `refresh.md` Phase 5 are ✅ AND the Phase
     7 smoke checklist passes, emit exactly `<promise>COMPLETE</promise>`
     as your final output line. Otherwise end naturally — the loop
     continues.

Hard rules:

  - One ticket per iteration. No batching, no "while I'm here."
  - Never regress a previously ✅ ticket. The Phase 7 smoke checklist
     is non-negotiable: inbox loads, j/k nav, Enter opens reader,
     compose sends, search works, mutations round-trip.
  - `apps/tui/src/index.tsx` should SHRINK every iteration, never grow.
  - If a ticket needs a human decision (e.g. Phase 3 prototype choices,
     keybind defaults, palette UX calls), write the question + your
     recommendation to `refresh-decisions.md`, end
     the iteration. Do NOT emit COMPLETE.
  - If you truly cannot make progress (blocker, ambiguity, missing
     dependency), append a dated note to `refresh-blockers.md`
     explaining why and what's needed, end the iteration.
  - Prefer porting patterns from `/Users/yash/Developer/oss/opencode`
     (opentui+Solid peer app) over inventing. File anchors for each
     primitive are in `refresh.md` Phase 2.
  - Do not touch `plan.md`, `prd.md`, or `progress.md` unless a ticket
     explicitly requires it. `refresh.md` is your scratchpad.

Permissions are pre-approved (`--permission-mode bypassPermissions`).
Use that trust carefully — destructive ops (git reset --hard, force
push, rm -rf) are still off-limits unless a ticket explicitly calls
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
