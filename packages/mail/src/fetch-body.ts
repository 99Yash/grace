import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convert as htmlToText } from "html-to-text";
import { simpleParser } from "mailparser";
import type { ImapFlow } from "imapflow";

const MIN_USEFUL_TEXT_LEN = 20;

const HTML_TO_TEXT_OPTS = {
  wordwrap: 100,
  selectors: [
    { selector: "img", format: "skip" as const },
    { selector: "a", options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
    { selector: "table", format: "dataTable" as const },
    { selector: ".preheader", format: "skip" as const },
    { selector: "style", format: "skip" as const },
    { selector: "script", format: "skip" as const },
  ],
};

/**
 * Derive readable plain text from HTML when a message has no usable text/plain
 * part. Returns null if conversion yields nothing useful.
 */
export function deriveTextFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  try {
    const t = htmlToText(html, HTML_TO_TEXT_OPTS).trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export function isTextUseful(text: string | null | undefined): text is string {
  return !!text && text.trim().length >= MIN_USEFUL_TEXT_LEN;
}

export interface FetchBodyOpts {
  client: ImapFlow;
  folderName: string;
  gmMsgid: string;
  uid: number;
  bodiesDir: string;
}

export interface FetchBodyResult {
  gmMsgid: string;
  text: string | null;
  html: string | null;
  htmlPath: string | null;
  rawPath: string;
  attachments: AttachmentMeta[];
  sizeBytes: number;
}

export interface AttachmentMeta {
  filename: string | null;
  contentType: string;
  size: number;
}

export async function fetchMessageBody(opts: FetchBodyOpts): Promise<FetchBodyResult> {
  const { client, folderName, gmMsgid, uid, bodiesDir } = opts;

  mkdirSync(bodiesDir, { recursive: true });

  const lock = await client.getMailboxLock(folderName);
  let source: Buffer;
  try {
    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) {
      throw new Error(`empty source for message ${gmMsgid} (uid ${uid}) in ${folderName}`);
    }
    source = msg.source;
  } finally {
    lock.release();
  }

  const rawPath = join(bodiesDir, `${gmMsgid}.eml`);
  writeFileSync(rawPath, source);

  const parsed = await simpleParser(source);

  const html = typeof parsed.html === "string" ? parsed.html : null;
  const rawText = parsed.text ?? null;
  const text = isTextUseful(rawText) ? rawText : (deriveTextFromHtml(html) ?? rawText);

  let htmlPath: string | null = null;
  if (html) {
    htmlPath = join(bodiesDir, `${gmMsgid}.html`);
    writeFileSync(htmlPath, html, "utf8");
  }

  const attachments: AttachmentMeta[] = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename ?? null,
    contentType: a.contentType ?? "application/octet-stream",
    size: a.size ?? 0,
  }));

  return {
    gmMsgid,
    text,
    html,
    htmlPath,
    rawPath,
    attachments,
    sizeBytes: source.byteLength,
  };
}
