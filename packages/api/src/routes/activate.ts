import { eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { getFreshAccessToken, loadActiveAccount } from "@grace/auth";
import { folders, messages } from "@grace/db";
import { requireGoogleOAuth } from "@grace/env/server";
import { bootstrapFolder, createImapClient, runBackfill } from "@grace/mail";
import { bus } from "../bus.ts";
import { maybeSyncCategories } from "../category-sync.ts";
import { db } from "../db.ts";
import { ensureFolderIdle } from "../folder-manager.ts";

const active = new Map<string, Promise<ActivateResult>>();
const backfilled = new Set<string>();

interface ActivateResult {
  folder: string;
  bootstrapped: boolean;
  messagesBefore: number;
  messagesAfter: number;
}

export const activateRoutes = new Elysia().post(
  "/folders/:name/activate",
  async ({ params, status }) => {
    const folderName = decodeURIComponent(params.name);
    try {
      const existing = active.get(folderName);
      if (existing) return await existing;
      const p = activateFolder(folderName);
      active.set(folderName, p);
      try {
        return await p;
      } finally {
        active.delete(folderName);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[activate] ${folderName} failed:`, message);
      return status(502, { error: message });
    }
  },
  {
    params: t.Object({ name: t.String() }),
  },
);

async function activateFolder(folderName: string): Promise<ActivateResult> {
  const before = countFolder(folderName);

  const email = loadActiveAccount();
  if (!email) throw new Error("not signed in — run `bun run oauth:login`");
  const { clientId, clientSecret } = requireGoogleOAuth();

  let bootstrapped = false;
  if (before === 0) {
    const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });
    const client = createImapClient({ email, accessToken });
    await client.connect();
    try {
      const res = await bootstrapFolder({
        client,
        db: db(),
        folderName,
        onProgress: (done, total) => {
          bus.publish({
            type: "folder.sync.progress",
            folder: folderName,
            done,
            target: total,
          });
        },
      });
      bootstrapped = true;
      bus.publish({
        type: "folder.synced",
        folder: folderName,
        count: res.inserted,
      });
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  }

  const after = countFolder(folderName);

  const idleResult = ensureFolderIdle(folderName);
  if (idleResult) console.log(`[activate:${folderName}] ${idleResult}`);

  if (!backfilled.has(folderName)) {
    backfilled.add(folderName);
    void runBackfill({
      email,
      clientId,
      clientSecret,
      db: db(),
      folderName,
      onProgress: (done, target) => {
        bus.publish({ type: "folder.sync.progress", folder: folderName, done, target });
      },
    })
      .then(() => maybeSyncCategories(folderName))
      .catch((err) => {
        backfilled.delete(folderName);
        console.error(
          `[backfill] ${folderName} failed:`,
          err instanceof Error ? err.message : err,
        );
      });
  }

  maybeSyncCategories(folderName);

  return {
    folder: folderName,
    bootstrapped,
    messagesBefore: before,
    messagesAfter: after,
  };
}

function countFolder(folderName: string): number {
  const row = db().select().from(folders).where(eq(folders.name, folderName)).get();
  if (!row) return 0;
  const c = db()
    .select({ c: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.folderId, row.id))
    .get();
  return Number(c?.c ?? 0);
}
