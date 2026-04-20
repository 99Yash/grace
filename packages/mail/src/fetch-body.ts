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
    { selector: "style", format: "skip" as const },
    { selector: "script", format: "skip" as const },
    { selector: "head", format: "skip" as const },
    { selector: "meta", format: "skip" as const },
    { selector: "link", format: "skip" as const },
    { selector: "title", format: "skip" as const },
    { selector: "hr", format: "skip" as const },
    // Hidden-preview preheader patterns. Email clients render these to give a
    // subject-line summary; in plain-text they'd leak above the real body.
    // CSS attribute-substring selectors are literal, so `display:none` won't
    // match `display: none` — we cover both spacings. Avoid opacity/max-height
    // because those match legitimate fractional values (0.9, 0.5em) and strip
    // real body content.
    { selector: ".preheader", format: "skip" as const },
    { selector: "[hidden]", format: "skip" as const },
    { selector: "[style*='display:none'i]", format: "skip" as const },
    { selector: "[style*='display: none'i]", format: "skip" as const },
    { selector: "[style*='visibility:hidden'i]", format: "skip" as const },
    { selector: "[style*='visibility: hidden'i]", format: "skip" as const },
    { selector: "[style*='mso-hide:all'i]", format: "skip" as const },
  ],
};

// Collapse 3+ runs of lines-with-only-whitespace into a single blank line.
// A plain /\n{3,}/ miss lines that carry spaces/tabs (common after skipped
// elements leave indented whitespace behind).
const BLANK_LINE_COLLAPSE = /(?:\n[ \t]*){3,}/g;

/**
 * Derive readable plain text from HTML when a message has no usable text/plain
 * part. Returns null if conversion yields nothing useful.
 */
export function deriveTextFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  try {
    const t = htmlToText(html, HTML_TO_TEXT_OPTS).replace(BLANK_LINE_COLLAPSE, "\n\n").trim();
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
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}

export interface AttachmentMeta {
  filename: string | null;
  contentType: string;
  size: number;
}

/**
 * Pull Message-ID / In-Reply-To / References from a raw RFC-822 source.
 * Scans only the header block so large HTML bodies don't cost anything.
 * simpleParser has this data too but re-parsing on every cache hit is
 * overkill when we only want 3 headers.
 */
export function extractReplyHeaders(raw: string | Buffer): {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
} {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const headerEnd = text.search(/\r?\n\r?\n/);
  const block = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const lines = unfolded.split(/\r?\n/);
  let messageId: string | null = null;
  let inReplyTo: string | null = null;
  let referencesRaw = "";
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const name = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (name === "message-id" && !messageId) messageId = firstBracketed(value);
    else if (name === "in-reply-to" && !inReplyTo) inReplyTo = firstBracketed(value);
    else if (name === "references" && !referencesRaw) referencesRaw = value;
  }
  const references = parseAllBracketed(referencesRaw);
  return { messageId, inReplyTo, references };
}

function firstBracketed(value: string): string | null {
  const m = value.match(/<([^>]+)>/);
  return m ? m[1]! : value.length > 0 ? value : null;
}

function parseAllBracketed(value: string): string[] {
  if (!value) return [];
  const out: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) out.push(m[1]!);
  return out;
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
  // Store the raw plain-text part verbatim. Callers derive from HTML on read so
  // html-to-text config changes apply to already-cached bodies without a rewrite.
  const text = parsed.text ?? null;

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

  const messageId = typeof parsed.messageId === "string" ? stripBrackets(parsed.messageId) : null;
  const inReplyTo = typeof parsed.inReplyTo === "string" ? stripBrackets(parsed.inReplyTo) : null;
  const references = normalizeReferences(parsed.references);

  return {
    gmMsgid,
    text,
    html,
    htmlPath,
    rawPath,
    attachments,
    sizeBytes: source.byteLength,
    messageId,
    inReplyTo,
    references,
  };
}

function stripBrackets(id: string): string {
  const m = id.match(/<([^>]+)>/);
  return m ? m[1]! : id;
}

function normalizeReferences(refs: string | string[] | undefined): string[] {
  if (!refs) return [];
  const arr = Array.isArray(refs) ? refs : [refs];
  return arr.map(stripBrackets).filter(Boolean);
}
