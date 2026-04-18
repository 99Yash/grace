import type { ImapFlow } from "imapflow";

export interface FolderEntry {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  /** `true` for Gmail `[Gmail]/…` container that can't hold mail. */
  noSelect: boolean;
  messages: number | null;
  unseen: number | null;
}

/**
 * Lists IMAP mailboxes with unread/total counts. Skips `\Noselect` containers
 * when filtering for "real" folders is desired. Does not open any mailbox.
 */
export async function listFolders(client: ImapFlow): Promise<FolderEntry[]> {
  const entries = await client.list({
    statusQuery: { messages: true, unseen: true },
  });
  return entries.map((e) => {
    const flags = e.flags ?? new Set<string>();
    const noSelect = flags.has("\\Noselect") || flags.has("\\NonExistent");
    return {
      path: e.path,
      name: e.name,
      delimiter: e.delimiter,
      specialUse: e.specialUse ?? null,
      noSelect,
      messages: e.status?.messages ?? null,
      unseen: e.status?.unseen ?? null,
    };
  });
}
