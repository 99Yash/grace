export function formatRelative(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  const d = new Date(ts);
  const now2 = new Date();
  if (d.getFullYear() === now2.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export type ReaderSegment =
  | { kind: "text"; text: string }
  | { kind: "blank" }
  | { kind: "quote"; content: string; count: number };

export function parseReaderBody(text: string): ReaderSegment[] {
  const out: ReaderSegment[] = [];
  let quote: string[] | null = null;
  const flush = () => {
    if (quote) {
      out.push({ kind: "quote", content: quote.join("\n"), count: quote.length });
      quote = null;
    }
  };
  for (const line of text.split("\n")) {
    if (/^\s*>/.test(line)) {
      (quote ??= []).push(line);
      continue;
    }
    flush();
    if (line.trim() === "") out.push({ kind: "blank" });
    else out.push({ kind: "text", text: line });
  }
  flush();
  return out;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;
const TRAIL_PUNCT = /[.,;!?:]+$/;

export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(TRAIL_PUNCT, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

const RE_PREFIX = /^\s*(re|aw|sv|r)\s*:\s*/i;

export function buildReplySubject(original: string | null): string {
  const trimmed = (original ?? "").trim();
  if (!trimmed) return "Re: ";
  return RE_PREFIX.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

type QuoteSource = {
  fromName: string | null;
  fromEmail: string | null;
  date: number;
};

export function buildQuotedBody(msg: QuoteSource, originalText: string): string {
  const who = msg.fromName ?? msg.fromEmail ?? "someone";
  const when = new Date(msg.date).toLocaleString();
  const quoted = originalText
    .split("\n")
    .map((line) => (line.length ? `> ${line}` : ">"))
    .join("\n");
  return `\n\nOn ${when}, ${who} wrote:\n${quoted}`;
}

export function buildReferences(existing: string[], messageId: string | null): string[] {
  const out = [...existing];
  if (messageId && !out.includes(messageId)) out.push(messageId);
  return out;
}

const GMAIL_REDUNDANT_LABELS = new Set([
  "\\Inbox",
  "\\Starred",
  "\\Unread",
  "\\Sent",
  "\\Draft",
  "\\Drafts",
  "\\Trash",
  "\\Spam",
  "\\Junk",
  "\\Chat",
  "\\Muted",
]);

export function displayLabelName(raw: string): string {
  // Strip leading backslash on system labels we chose to surface (e.g. "\Important" → "Important").
  return raw.startsWith("\\") ? raw.slice(1) : raw;
}

export function visibleLabels(
  labels: string[] | null | undefined,
  activeFolder: string,
  max = 2,
): { shown: string[]; extra: number } {
  if (!labels || labels.length === 0) return { shown: [], extra: 0 };
  const seen = new Set<string>();
  const filtered: string[] = [];
  for (const raw of labels) {
    if (!raw) continue;
    if (GMAIL_REDUNDANT_LABELS.has(raw)) continue;
    if (raw === activeFolder) continue;
    const name = displayLabelName(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    filtered.push(name);
  }
  if (filtered.length <= max) return { shown: filtered, extra: 0 };
  return { shown: filtered.slice(0, max), extra: filtered.length - max };
}
