import type { ImapFlow } from "imapflow";
import { eq } from "drizzle-orm";
import { folders, type GraceDB } from "@grace/db";
import { FETCH_HEADER_FIELDS, persistHeaderMessage } from "./persist.ts";

export interface IdleWorkerOpts {
  client: ImapFlow;
  db: GraceDB;
  folderName: string;
  onNewMessage?: (info: { gmMsgid: string; subject: string | null }) => void;
}

export interface IdleWorker {
  stop: () => Promise<void>;
}

export async function startIdleWorker(opts: IdleWorkerOpts): Promise<IdleWorker> {
  const { client, db, folderName, onNewMessage } = opts;

  const folder = db.select().from(folders).where(eq(folders.name, folderName)).get();
  if (!folder) {
    throw new Error(
      `Folder ${folderName} not bootstrapped in SQLite — run \`bun run smoke:bootstrap\` first.`,
    );
  }
  const folderId = folder.id;

  const handleExists = async (data: { path: string; count: number; prevCount: number }) => {
    if (data.path !== folderName) return;
    const newCount = data.count - data.prevCount;
    console.log(
      `[idle] exists event · count=${data.count} prev=${data.prevCount} new=${newCount} t=${new Date().toISOString()}`,
    );
    if (newCount <= 0) return;

    const range = `${data.prevCount + 1}:*`;
    for await (const msg of client.fetch(range, FETCH_HEADER_FIELDS)) {
      if (!persistHeaderMessage(db, folderId, msg)) continue;
      onNewMessage?.({ gmMsgid: msg.emailId ?? "", subject: msg.envelope?.subject ?? null });
    }
  };

  // Attach BEFORE opening mailbox so we don't miss events between open and attach.
  client.on("exists", handleExists);
  await client.mailboxOpen(folderName);
  console.log(`[idle] mailbox open: ${folderName} · auto-IDLE active`);

  return {
    async stop() {
      client.off("exists", handleExists);
      try {
        await client.logout();
      } catch {
        // ignore
      }
    },
  };
}
