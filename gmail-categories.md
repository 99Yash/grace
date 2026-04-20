# Gmail Categories sync — plan

Populate grace's inbox tabs (Primary / Promotions / Social / Updates / Forums) with the correct set of messages, matching Gmail's own categorisation.

## Problem

Gmail's IMAP protocol does **not** expose `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`, or `CATEGORY_PERSONAL` via `X-GM-LABELS`. `X-GM-LABELS` returns user labels and the core system labels (`\Inbox`, `\Important`, `\Starred`, `\Sent`, `\Draft`, `\Trash`, `\Junk`) — nothing else. Gmail web can show Primary/Promotions/Social/Updates/Forums tabs because it uses the Gmail HTTP API, which does expose them.

Empirical check against the local DB: 0/1004 messages have any `CATEGORY_*` label, even though the user has Inbox Categories enabled in Gmail web. The UI tabs exist and filter correctly — they just have nothing to filter on.

## Goal

Side-channel into Gmail's HTTP API to fetch category labels for messages we already hold over IMAP, merge those labels onto our local rows, and let the existing TUI filter do its job. No new OAuth scope required — `https://mail.google.com/` already grants Gmail API access. IMAP remains the authoritative source for everything else.

## Approach options

### A — REST `messages.list` per category (chosen)

For each of the five category labels, call `GET https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=CATEGORY_X&maxResults=500`, page through until we've covered our local window, then `UPDATE messages SET labels = …` to add the category to matching rows.

- Calls per full sync: **5** (one per category), plus pagination if a category has > 500 matches.
- Quota: `messages.list` is 5 units; 5 calls = 25 units. User quota is 250 units/sec. Negligible.

### B — Per-message `messages.get`

For each message in our DB, call `messages.get?id=X&format=minimal&fields=labelIds`.

- Calls per full sync: **~1000** (our window size).
- Rejected: 200× more expensive than A for the same data.

### C — Gmail batch endpoint

Multipart `messages.get` batches of 100.

- Calls per full sync: ~10.
- Rejected: still strictly more expensive than A, and adds multipart parsing.

### D — Replace IMAP with Gmail API

Out of scope. IMAP is load-bearing for everything else in grace; tearing it out is a separate project.

### E — Classify ourselves (heuristics / Claude)

Different product — it would disagree with Gmail's assignment and defeat the purpose of matching the user's web UI.

**Chosen: A.** Cheapest, additive, 5 API calls for a full inbox.

## Implementation

### Module: `packages/mail/src/gmail-api.ts`

Thin HTTP client. Bun's `fetch` — no new deps.

```typescript
export type CategoryLabel =
  | "CATEGORY_PROMOTIONS"
  | "CATEGORY_SOCIAL"
  | "CATEGORY_UPDATES"
  | "CATEGORY_FORUMS"
  | "CATEGORY_PERSONAL";

export interface GmailApi {
  listCategoryMessageIds(category: CategoryLabel, max: number): Promise<string[]>;
}

export function createGmailApi(tokens: TokenProvider): GmailApi;
```

- `tokens` is the same `@grace/auth` token provider IMAP uses — a `getAccessToken()` thunk that handles refresh transparently.
- On `401`, call `tokens.refresh()` and retry once.
- On `429` or `5xx`, exponential backoff with `Retry-After` respected. Give up after 3 attempts and surface the error to the caller; categories are decoration, never block IMAP sync.
- Pagination loop: stops at `max` IDs or when `nextPageToken` is missing.

### Module: `packages/mail/src/sync-categories.ts`

Orchestrator.

```typescript
export async function syncCategories(
  db: GraceDB,
  api: GmailApi,
  opts?: { limit?: number },
): Promise<{ labeled: number; skipped: number }>;
```

1. For each of the five categories: fetch up to `limit` (default 1000) message IDs.
2. Convert Gmail API hex IDs → decimal (see ID mapping below).
3. In a single transaction, for each category: read the `labels` JSON for matching rows, append the category if not already present, write back.
4. Emit `mail.updated { gmMsgid }` on the event bus for every row we changed so the TUI re-renders.

Returns counts for logging.

### ID mapping — hex ↔ decimal

Gmail's internal message identifier is a 64-bit integer. IMAP's `X-GM-MSGID` returns it decimal; Gmail API returns it lowercase hex. Both encode the same number.

imapflow gives us `emailId` (decimal string) which we persist as `messages.gmMsgid`. Gmail API gives us `id` (hex string). Conversion is one-way at query time:

```typescript
function apiIdToGmMsgid(hex: string): string {
  return BigInt("0x" + hex).toString(10);
}
```

Cheap. No DB migration, no dual index.

### Schema

No change. `messages.labels` is already a JSON text array. The category sits alongside user labels.

Future optimisation: a dedicated `category TEXT` column for indexed filters. Skip for now — our in-memory filter over 1000 rows takes <1ms.

### Integration points

| Trigger | What runs | Cost |
|---------|-----------|------|
| Bootstrap (first sync of INBOX) | `syncCategories` after IMAP completes | 5 calls, one-shot |
| Backfill batch finishes | `syncCategories` after each 200-msg batch lands | 5 calls per batch |
| `mail.received` SSE event | `messages.get?id=X&fields=labelIds` for the one new message | 1 call |
| Manual refresh (`r` or palette action) | `syncCategories` | 5 calls |
| Folder switch to INBOX | `syncCategories` if last run > 5 min ago | 5 calls, debounced |

`messages.get` for a single new message is the right tool for `mail.received`: we already know the ID, batching 5 listing calls per new message would be wasteful.

### Event emission

`syncCategories` publishes one `mail.updated` event per changed row. The TUI already subscribes and refetches. Tabs fill in progressively rather than in one flash.

## Edge cases

1. **Inbox Categories disabled in Gmail.** `messages.list?labelIds=CATEGORY_X` returns empty. Tabs stay empty — correct behaviour.
2. **Message assigned to two categories.** Doesn't happen — Gmail assigns exactly one — but our merge is idempotent either way.
3. **Message moved out of INBOX but still in its category.** `messages.list` returns it; we label it. The INBOX-scoped tab filter never shows it because it's not in our INBOX query results. No harm.
4. **Local row has no `gmMsgid`.** `persistHeaderMessage` already skips rows without an `emailId`. Nothing to join on; API results silently drop.
5. **Primary filter semantics.** Our current Primary filter is *"has none of the other four categories"*. Proposal: keep inverse rather than switching to *"has `CATEGORY_PERSONAL`"*. Reason: accounts with categories disabled have no `CATEGORY_*` labels at all, and the inverse filter makes Primary = all of INBOX in that case, which is the right fallback. Switching to `CATEGORY_PERSONAL` would make Primary empty for those accounts.
6. **Category retroactively applied.** When a user turns Inbox Categories on, Gmail backfills labels on existing messages server-side. Our sync picks them up on the next run.
7. **Token expiry mid-sync.** Refresh via `@grace/auth`, retry once. Second failure: abort this category, continue the others, log and move on.
8. **Rate limit.** Well under quota. If we somehow hit `429`, respect `Retry-After` and surrender after 3 attempts.
9. **Pagination beyond window.** Default window is 1000 messages. We cap `listCategoryMessageIds` at 1000 IDs per category. Larger inboxes get the most-recent 1000 — same trade-off as the IMAP window.
10. **Network partition during sync.** `syncCategories` is all-or-partial — each category is independent; a failure on Promotions doesn't invalidate Social. Existing rows keep their previously-assigned categories until the next sync.
11. **Concurrent IMAP write + category sync.** Both paths end with `UPDATE messages … labels = ?`. If IMAP rewrites `labels` between our read and write, we clobber its update. Fix: the update runs inside a transaction and uses `UPDATE … SET labels = json(?) WHERE gmMsgid = ? AND labels_version = ?` with an incrementing version column — or simpler, do the merge in SQL using a `json_insert` expression so we never read-modify-write in JS. Prefer the SQL path.
12. **Label name drift.** Gmail has changed category names in the past (e.g. `CATEGORY_UPDATES` was briefly `CATEGORY_NEWS`). Hard-coded constants in the UI and sync module must stay in sync. Low risk — Gmail hasn't renamed these in years.

## Tradeoffs

| Decision | Pro | Con |
|----------|-----|-----|
| Store categories in existing `messages.labels` JSON | No schema change | Requires SQL-side merge to avoid clobbering IMAP writes |
| 5 list calls vs per-message get | 200× fewer API calls | Pagination needed for large categories |
| Opportunistic sync (after IMAP batches) vs lazy (on tab click) | Tabs feel instant, no loading UI | Slight work on each sync event even if user never opens the tab |
| Hex↔decimal at the JS layer | Zero DB migration | `BigInt` per match; cost is invisible at our scale |
| IMAP as authoritative + HTTP API as augmenter | Additive, reversible, can be deleted if Gmail ever exposes categories over IMAP | Two sources of truth for labels; discipline required to keep IMAP label changes from overwriting categories (see edge case 11) |

## Constraints

- No new OAuth scope — `https://mail.google.com/` is sufficient.
- No new external dependencies — Bun `fetch` is enough.
- Must be additive: the TUI, IMAP path, and schema stay untouched for this phase.
- Must degrade gracefully: if the Gmail API call fails for any reason, the user still sees the full INBOX in the Primary tab. Categories are decoration.

## Decisions

1. **Primary filter** = inverse (no `CATEGORY_*` labels). Works for accounts with Inbox Categories disabled — Primary stays as all-of-INBOX in that case.
2. **Folder-switch sync** = debounced at 5 min staleness.

## Open questions

1. **Capability flag?** `/api/capabilities` could expose `{ categories: boolean }` once we've successfully queried the Gmail API the first time, so the TUI can hide the tab strip for accounts that genuinely have no categories. Phase 4 concern.
2. **Persist a `categories_synced_at` timestamp per folder?** Needed for the "sync if stale" logic. Tiny column addition, worth it.

## Rollout

1. **Phase 1 — client + bootstrap.** `gmail-api.ts`, `sync-categories.ts`, hook into `bootstrap.ts`. Ship behind a feature flag (`GRACE_CATEGORIES=1`). Verify one account's tabs populate.
2. **Phase 2 — incremental.** Wire into backfill completion and `mail.received`. Remove the flag.
3. **Phase 3 — ops.** Palette command "Resync categories"; `grace doctor` reports last sync time and category counts per tab.
4. **Phase 4 — polish.** Capability flag + conditional tab strip; revisit Primary filter semantics.

Each phase is independently shippable and reversible.

## Testing

- Unit: `apiIdToGmMsgid` round-trip over 100 sampled hex values.
- Unit: `syncCategories` against a seeded in-memory DB + mocked API responses — verifies merge, idempotency, and event emission.
- Integration: toggle Inbox Categories in Gmail web, press `r` in grace, confirm Promotions tab fills within one sync cycle.
- Failure mode: point the API client at a 401-returning fixture, assert one refresh + one retry then clean abort.

## Security

- Access token lives in keychain (keytar), never logged.
- API responses contain no PII beyond what IMAP already delivers.
- Rate-limit or permission errors are logged and swallowed for category paths — never surface as fatal to the user.
