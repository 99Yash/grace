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
