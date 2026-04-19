import { treaty } from "@elysiajs/eden";
import type { App as ApiApp, DraftRecord, SearchHit } from "@grace/api";
import { DAEMON_DEFAULT_HOST, DAEMON_DEFAULT_PORT } from "@grace/env";

export const client = treaty<ApiApp>(`http://${DAEMON_DEFAULT_HOST}:${DAEMON_DEFAULT_PORT}`);
export const DEBUG = Boolean(process.env.GRACE_DEBUG);
export const DAEMON_BASE_URL = `http://${DAEMON_DEFAULT_HOST}:${DAEMON_DEFAULT_PORT}`;

export type Message = {
  gmMsgid: string;
  gmThrid: string | null;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  date: number;
  read: boolean;
  starred: boolean;
  labels: string[];
};

export type Body = {
  gmMsgid: string;
  text: string | null;
  html: string | null;
  htmlPath: string | null;
  rawPath: string;
  attachments: { filename: string | null; contentType: string; size: number }[];
  sizeBytes: number;
  cached: boolean;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
};

export type Capabilities = { w3m: boolean };

export type Folder = {
  path: string;
  name: string;
  specialUse: string | null;
  noSelect: boolean;
  messages: number | null;
  unseen: number | null;
  tracked: boolean;
};

export type MutateAction = "toggle-read" | "toggle-star" | "archive" | "trash";

export interface SendResult {
  ok: true;
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export type ComposeField = "to" | "cc" | "bcc" | "attachments" | "subject" | "body";

export async function fetchAuth() {
  const r = await client.api.auth.status.get();
  if (r.error) throw r.error;
  return r.data;
}

export async function startLogin(): Promise<{ email: string }> {
  const r = await client.api.auth.login.post();
  if (r.error) {
    const data = r.error.value as { error?: string } | undefined;
    throw new Error(data?.error ?? `login failed (${r.error.status})`);
  }
  const data = r.data as { email?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.email) throw new Error("login returned no email");
  return { email: data.email };
}

export async function fetchMessages(folder: string): Promise<Message[]> {
  const r = await client.api.messages.get({ query: { folder, limit: "1000" } });
  if (r.error) throw r.error;
  return (r.data?.messages ?? []) as Message[];
}

export async function fetchFolders(refresh = false): Promise<Folder[]> {
  const r = await client.api.folders.get({ query: refresh ? { refresh: "1" } : {} });
  if (r.error) throw r.error;
  return ((r.data as { folders?: Folder[] })?.folders ?? []).filter((f) => !f.noSelect);
}

export async function activateFolder(path: string): Promise<void> {
  const r = await client.api.folders({ name: path }).activate.post();
  if (r.error) throw r.error;
}

export async function fetchCapabilities(): Promise<Capabilities> {
  const r = await client.api.capabilities.get();
  if (r.error) throw r.error;
  return r.data as Capabilities;
}

export async function fetchBody(gmMsgid: string): Promise<Body> {
  const r = await client.api.messages({ gmMsgid }).body.get();
  if (r.error) throw r.error;
  return r.data as Body;
}

export async function mutateMessage(gmMsgid: string, action: MutateAction): Promise<{ removed: boolean }> {
  const r = await client.api.messages({ gmMsgid }).mutate.post({ action });
  if (r.error) throw r.error;
  return { removed: Boolean((r.data as { removed?: boolean })?.removed) };
}

export async function labelMessage(
  gmMsgid: string,
  change: { add?: string[]; remove?: string[] },
): Promise<{ labels: string[] }> {
  const r = await client.api.messages({ gmMsgid }).labels.post(change);
  if (r.error) throw r.error;
  return { labels: ((r.data as { labels?: string[] })?.labels ?? []) };
}

export async function sendDraft(draft: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: string[];
}): Promise<SendResult> {
  const r = await client.api.send.post(draft);
  if (r.error) throw r.error;
  return r.data as SendResult;
}

export async function fetchCurrentDraft(): Promise<DraftRecord | null> {
  const r = await client.api.drafts.current.get();
  if (r.error) throw r.error;
  const data = r.data as { draft: DraftRecord | null };
  return data.draft;
}

export async function saveCurrentDraft(draft: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  attachments?: string;
}): Promise<void> {
  const r = await client.api.drafts.current.put(draft);
  if (r.error) throw r.error;
}

export async function deleteCurrentDraft(): Promise<void> {
  const r = await client.api.drafts.current.delete();
  if (r.error) throw r.error;
}

export async function importHit(hit: SearchHit): Promise<void> {
  const r = await client.api.messages.import.post({
    gmMsgid: hit.gmMsgid,
    gmThrid: hit.gmThrid,
    folder: hit.folder,
    uid: hit.uid,
    subject: hit.subject,
    fromName: hit.fromName,
    fromEmail: hit.fromEmail,
    date: hit.date,
    read: hit.read,
    starred: hit.starred,
    labels: hit.labels,
  });
  if (r.error) throw r.error;
}

export async function w3mDump(htmlPath: string): Promise<string> {
  const proc = Bun.spawn(["w3m", "-dump", "-T", "text/html", htmlPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

export function openInBrowser(path: string): void {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([opener, path]);
}

export function hitToMessage(h: SearchHit): Message {
  return {
    gmMsgid: h.gmMsgid,
    gmThrid: h.gmThrid,
    subject: h.subject,
    fromName: h.fromName,
    fromEmail: h.fromEmail,
    date: h.date,
    read: h.read,
    starred: h.starred,
    labels: h.labels,
  };
}

const SPECIAL_ORDER: Record<string, number> = {
  "\\Important": 2,
  "\\Flagged": 3,
  "\\Drafts": 4,
  "\\Sent": 5,
  "\\All": 6,
  "\\Junk": 7,
  "\\Trash": 8,
};

export function orderFolders(fs: Folder[]): Folder[] {
  const rank = (f: Folder): number => {
    if (f.path === "INBOX") return 1;
    if (f.specialUse && f.specialUse in SPECIAL_ORDER) return SPECIAL_ORDER[f.specialUse]!;
    return 9;
  };
  return [...fs].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });
}

export function toastForAction(a: MutateAction): string {
  switch (a) {
    case "archive": return "archived";
    case "trash": return "moved to trash";
    case "toggle-read": return "toggled read";
    case "toggle-star": return "toggled star";
  }
}
