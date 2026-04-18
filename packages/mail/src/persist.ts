import type { FetchMessageObject } from "imapflow";
import { messages, type GraceDB } from "@grace/db";

export const FETCH_HEADER_FIELDS = {
  uid: true,
  envelope: true,
  flags: true,
  labels: true,
  threadId: true,
  emailId: true,
} as const;

/**
 * Upsert a single message header row. Returns true if the message had a stable
 * gmMsgid and the row was inserted (or ignored-on-conflict if already present).
 */
export function persistHeaderMessage(
  db: GraceDB,
  folderId: number,
  msg: FetchMessageObject,
): boolean {
  const gmMsgid = msg.emailId;
  if (!gmMsgid) return false;

  const env = msg.envelope;
  const from = env?.from?.[0];
  const flagSet = Array.from(msg.flags ?? []);
  const labelSet = Array.from((msg as { labels?: Set<string> }).labels ?? []);

  db.insert(messages)
    .values({
      gmMsgid,
      gmThrid: msg.threadId ?? null,
      folderId,
      uid: msg.uid,
      subject: env?.subject ?? null,
      fromName: from?.name ?? null,
      fromEmail: from && from.mailbox && from.host ? `${from.mailbox}@${from.host}` : null,
      date: env?.date ? new Date(env.date) : new Date(),
      snippet: null,
      flags: JSON.stringify(flagSet),
      labels: JSON.stringify(labelSet),
      read: flagSet.includes("\\Seen"),
      starred: flagSet.includes("\\Flagged"),
    })
    .onConflictDoNothing()
    .run();

  return true;
}
