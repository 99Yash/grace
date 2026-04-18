import { eq, sql } from "drizzle-orm";
import { folders, messages, type GraceDB } from "@grace/db";
import { getFreshAccessToken } from "@grace/auth";
import { createImapClient } from "./imap.ts";
import { FETCH_HEADER_FIELDS, persistHeaderMessage } from "./persist.ts";

export interface BackfillOpts {
  email: string;
  clientId: string;
  clientSecret: string;
  db: GraceDB;
  folderName: string;
  target?: number;
  batchSize?: number;
  onProgress?: (done: number, target: number) => void;
  signal?: AbortSignal;
}

export const DEFAULT_BACKFILL_TARGET = 1000;
export const DEFAULT_BACKFILL_BATCH = 100;
const BATCH_PAUSE_MS = 300;

/**
 * Backfills older headers until local count reaches `target` or the mailbox is
 * exhausted. Uses its own IMAP connection so it doesn't interfere with IDLE.
 * Safe to run repeatedly — no-ops once the window is filled.
 */
export async function runBackfill(opts: BackfillOpts): Promise<{ done: number; target: number }> {
  const {
    email,
    clientId,
    clientSecret,
    db,
    folderName,
    target = DEFAULT_BACKFILL_TARGET,
    batchSize = DEFAULT_BACKFILL_BATCH,
    onProgress,
    signal,
  } = opts;

  const folder = db.select().from(folders).where(eq(folders.name, folderName)).get();
  if (!folder) {
    throw new Error(`Folder ${folderName} not bootstrapped — nothing to backfill from.`);
  }
  const folderId = folder.id;

  const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });
  const client = createImapClient({ email, accessToken });
  await client.connect();

  const aborted = () => signal?.aborted ?? false;
  let done = countLocal(db, folderId);
  const actualTarget = target;

  try {
    const lock = await client.getMailboxLock(folderName);
    try {
      const mb = client.mailbox;
      const mailboxTotal = typeof mb === "object" ? mb.exists : 0;
      const effectiveTarget = Math.min(actualTarget, mailboxTotal);

      onProgress?.(done, effectiveTarget);
      if (done >= effectiveTarget) {
        console.log(`[backfill] ${folderName} already at ${done}/${effectiveTarget} — nothing to do`);
        return { done, target: effectiveTarget };
      }

      console.log(`[backfill] ${folderName} starting · local=${done} target=${effectiveTarget} mailbox=${mailboxTotal}`);

      while (!aborted() && done < effectiveTarget) {
        const minUid = minLocalUid(db, folderId);
        if (!minUid || minUid <= 1) {
          console.log(`[backfill] no room to go older · minUid=${minUid}`);
          break;
        }

        const olderUids = (await client.search(
          { uid: `1:${minUid - 1}` },
          { uid: true },
        )) ?? [];
        if (olderUids.length === 0) {
          console.log(`[backfill] mailbox exhausted below uid=${minUid}`);
          break;
        }

        const batch = olderUids.slice(-batchSize);
        let batchInserted = 0;
        for await (const msg of client.fetch(batch, FETCH_HEADER_FIELDS, { uid: true })) {
          if (aborted()) break;
          if (persistHeaderMessage(db, folderId, msg)) batchInserted++;
        }

        done = countLocal(db, folderId);
        onProgress?.(done, effectiveTarget);
        console.log(`[backfill] +${batchInserted} · ${done}/${effectiveTarget}`);

        if (batchInserted === 0) {
          // Safety net — shouldn't happen, but avoid a runaway loop.
          console.warn(`[backfill] zero inserts this batch — stopping`);
          break;
        }

        if (!aborted() && done < effectiveTarget) {
          await sleep(BATCH_PAUSE_MS);
        }
      }

      onProgress?.(done, effectiveTarget);
      return { done, target: effectiveTarget };
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

function countLocal(db: GraceDB, folderId: number): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.folderId, folderId))
    .get();
  return Number(row?.c ?? 0);
}

function minLocalUid(db: GraceDB, folderId: number): number | null {
  const row = db
    .select({ m: sql<number | null>`min(uid)` })
    .from(messages)
    .where(eq(messages.folderId, folderId))
    .get();
  const v = row?.m ?? null;
  return v == null ? null : Number(v);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
