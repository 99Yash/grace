import type { ImapFlow } from "imapflow";

export const GMAIL_ALL_MAIL = "[Gmail]/All Mail";
export const GMAIL_TRASH = "[Gmail]/Trash";

export type MutationAction =
  | { type: "read"; value: boolean }
  | { type: "star"; value: boolean }
  | { type: "archive" }
  | { type: "trash" };

export interface MutationTarget {
  folderName: string;
  uid: number;
}

export interface ApplyMutationResult {
  /** true if the message was moved out of its source folder (archive/trash). */
  removedFromSource: boolean;
}

export async function applyMutation(
  client: ImapFlow,
  target: MutationTarget,
  action: MutationAction,
): Promise<ApplyMutationResult> {
  const { folderName, uid } = target;
  const lock = await client.getMailboxLock(folderName);
  try {
    switch (action.type) {
      case "read": {
        const flag = ["\\Seen"];
        const ok = action.value
          ? await client.messageFlagsAdd(String(uid), flag, { uid: true })
          : await client.messageFlagsRemove(String(uid), flag, { uid: true });
        if (!ok) throw new Error(`STORE \\Seen (${action.value}) failed for uid ${uid}`);
        return { removedFromSource: false };
      }
      case "star": {
        const flag = ["\\Flagged"];
        const ok = action.value
          ? await client.messageFlagsAdd(String(uid), flag, { uid: true })
          : await client.messageFlagsRemove(String(uid), flag, { uid: true });
        if (!ok) throw new Error(`STORE \\Flagged (${action.value}) failed for uid ${uid}`);
        return { removedFromSource: false };
      }
      case "archive": {
        const res = await client.messageMove(String(uid), GMAIL_ALL_MAIL, { uid: true });
        if (!res) throw new Error(`archive move failed for uid ${uid}`);
        return { removedFromSource: true };
      }
      case "trash": {
        const res = await client.messageMove(String(uid), GMAIL_TRASH, { uid: true });
        if (!res) throw new Error(`trash move failed for uid ${uid}`);
        return { removedFromSource: true };
      }
    }
  } finally {
    lock.release();
  }
}
