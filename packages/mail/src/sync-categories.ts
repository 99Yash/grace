import { eq, sql } from "drizzle-orm";
import { folders, type GraceDB } from "@grace/db";
import {
  apiIdToGmMsgid,
  CATEGORY_LABELS,
  createGmailApi,
  type CategoryLabel,
  type GmailApi,
  type GmailApiOpts,
} from "./gmail-api.ts";

export interface SyncCategoriesOpts {
  db: GraceDB;
  folderName?: string;
  email: string;
  clientId: string;
  clientSecret: string;
  limit?: number;
  signal?: AbortSignal;
  onLabelChange?: (gmMsgid: string) => void;
}

export interface SyncCategoriesResult {
  labeled: number;
  perCategory: Record<CategoryLabel, number>;
  fetchedIds: number;
  durationMs: number;
}

const DEFAULT_LIMIT = 1000;

/**
 * Augments local message rows with Gmail `CATEGORY_*` labels pulled from the
 * Gmail HTTP API (IMAP doesn't expose them). Idempotent and non-destructive:
 * existing labels are preserved; the category is only appended if missing.
 * Scopes to `folderName` (default INBOX) so we don't label messages the user
 * isn't looking at.
 */
export async function syncCategories(opts: SyncCategoriesOpts): Promise<SyncCategoriesResult> {
  const started = Date.now();
  const {
    db,
    folderName = "INBOX",
    limit = DEFAULT_LIMIT,
    signal,
    onLabelChange,
  } = opts;

  const folder = db.select().from(folders).where(eq(folders.name, folderName)).get();
  if (!folder) {
    return {
      labeled: 0,
      perCategory: emptyCounts(),
      fetchedIds: 0,
      durationMs: Date.now() - started,
    };
  }
  const folderId = folder.id;

  const apiOpts: GmailApiOpts = {
    email: opts.email,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
  };
  if (signal) apiOpts.signal = signal;
  const api = createGmailApi(apiOpts);

  const perCategory = emptyCounts();
  let labeled = 0;
  let fetchedIds = 0;

  for (const category of CATEGORY_LABELS) {
    if (signal?.aborted) break;
    try {
      const hexIds = await api.listCategoryMessageIds(category, limit);
      fetchedIds += hexIds.length;
      if (hexIds.length === 0) continue;
      const gmMsgids = hexIds.map(apiIdToGmMsgid);
      const count = mergeCategoryLabel(db, folderId, gmMsgids, category, onLabelChange);
      perCategory[category] = count;
      labeled += count;
    } catch (err) {
      console.warn(
        `[categories] ${category} sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    labeled,
    perCategory,
    fetchedIds,
    durationMs: Date.now() - started,
  };
}

/**
 * Adds `category` to `labels` for the given gmMsgids, but only for rows that
 * belong to `folderId` AND don't already have the label. Runs as one UPDATE per
 * chunk to avoid round-trips and stays atomic per row, so a concurrent IMAP
 * write to `labels` can't lose the category (or vice-versa) in the usual case.
 * Returns the number of rows actually changed.
 */
function mergeCategoryLabel(
  db: GraceDB,
  folderId: number,
  gmMsgids: string[],
  category: CategoryLabel,
  onLabelChange?: (gmMsgid: string) => void,
): number {
  if (gmMsgids.length === 0) return 0;

  const CHUNK = 400;
  let changed = 0;
  for (let i = 0; i < gmMsgids.length; i += CHUNK) {
    const chunk = gmMsgids.slice(i, i + CHUNK);
    const ids = sql.join(chunk.map((v) => sql`${v}`), sql`, `);
    const rows = db.all<{ gm_msgid: string }>(sql`
      UPDATE messages
         SET labels = json_insert(labels, '$[#]', ${category})
       WHERE folder_id = ${folderId}
         AND gm_msgid IN (${ids})
         AND NOT EXISTS (
           SELECT 1 FROM json_each(messages.labels) WHERE value = ${category}
         )
       RETURNING gm_msgid
    `);
    for (const r of rows) {
      changed++;
      onLabelChange?.(r.gm_msgid);
    }
  }
  return changed;
}

function emptyCounts(): Record<CategoryLabel, number> {
  return {
    CATEGORY_PROMOTIONS: 0,
    CATEGORY_SOCIAL: 0,
    CATEGORY_UPDATES: 0,
    CATEGORY_FORUMS: 0,
    CATEGORY_PERSONAL: 0,
  };
}

export { type GmailApi } from "./gmail-api.ts";
