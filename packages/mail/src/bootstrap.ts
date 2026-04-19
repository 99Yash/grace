import type { ImapFlow } from "imapflow";
import { eq } from "drizzle-orm";
import { folders, type GraceDB } from "@grace/db";
import { FETCH_HEADER_FIELDS, persistHeaderMessage } from "./persist.ts";

export const DEFAULT_BOOTSTRAP_LIMIT = 500;

export interface BootstrapOpts {
  client: ImapFlow;
  db: GraceDB;
  folderName: string;
  limit?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface BootstrapResult {
  folderId: number;
  inserted: number;
  total: number;
  uidValidity: number | undefined;
  highestModseq: string | null;
}

export async function bootstrapFolder(opts: BootstrapOpts): Promise<BootstrapResult> {
  const { client, db, folderName, limit = DEFAULT_BOOTSTRAP_LIMIT, onProgress } = opts;

  const lock = await client.getMailboxLock(folderName);
  try {
    const mb = client.mailbox;
    if (typeof mb !== "object") throw new Error(`Failed to open ${folderName}`);

    const existing = db.select().from(folders).where(eq(folders.name, folderName)).get();
    const folderId = existing
      ? existing.id
      : db
          .insert(folders)
          .values({
            name: folderName,
            uidValidity: Number(mb.uidValidity),
            highestModseq: mb.highestModseq?.toString() ?? null,
          })
          .returning({ id: folders.id })
          .get().id;

    if (!mb.exists || mb.exists === 0) {
      return {
        folderId,
        inserted: 0,
        total: 0,
        uidValidity: Number(mb.uidValidity),
        highestModseq: mb.highestModseq?.toString() ?? null,
      };
    }

    const start = Math.max(1, mb.exists - limit + 1);
    const range = `${start}:${mb.exists}`;
    const total = mb.exists - start + 1;

    let inserted = 0;
    for await (const msg of client.fetch(range, FETCH_HEADER_FIELDS)) {
      if (persistHeaderMessage(db, folderId, msg)) {
        inserted++;
        if (onProgress && inserted % 25 === 0) onProgress(inserted, total);
      }
    }

    db.update(folders)
      .set({
        uidValidity: Number(mb.uidValidity),
        highestModseq: mb.highestModseq?.toString() ?? null,
        lastSyncedAt: new Date(),
      })
      .where(eq(folders.id, folderId))
      .run();

    if (onProgress) onProgress(inserted, total);

    return {
      folderId,
      inserted,
      total,
      uidValidity: Number(mb.uidValidity),
      highestModseq: mb.highestModseq?.toString() ?? null,
    };
  } finally {
    lock.release();
  }
}
