import { getFreshAccessToken } from "@grace/auth";

export type CategoryLabel =
  | "CATEGORY_PROMOTIONS"
  | "CATEGORY_SOCIAL"
  | "CATEGORY_UPDATES"
  | "CATEGORY_FORUMS"
  | "CATEGORY_PERSONAL";

export const CATEGORY_LABELS: readonly CategoryLabel[] = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
  "CATEGORY_PERSONAL",
] as const;

export interface GmailApiOpts {
  email: string;
  clientId: string;
  clientSecret: string;
  signal?: AbortSignal;
}

export interface GmailApi {
  listCategoryMessageIds(category: CategoryLabel, max: number): Promise<string[]>;
  getMessageLabels(apiId: string): Promise<string[]>;
}

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_ATTEMPTS = 3;

export function createGmailApi(opts: GmailApiOpts): GmailApi {
  async function request(path: string): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (opts.signal?.aborted) throw new Error("aborted");
      const token = await getFreshAccessToken({
        email: opts.email,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
      });
      const init: RequestInit = {
        headers: { Authorization: `Bearer ${token}` },
      };
      if (opts.signal) init.signal = opts.signal;
      const res = await fetch(`${BASE}${path}`, init);
      if (res.ok) return res.json();
      if (res.status === 401) {
        // Force a refresh on the next loop; the refresh helper does this by
        // checking expiry, so nudge the window by doing nothing special —
        // getFreshAccessToken returns a fresh token when the cached one is
        // near-expiry. If we still get 401 twice in a row, bail.
        lastErr = new Error(`401 unauthorized`);
        if (attempt === MAX_ATTEMPTS - 1) throw lastErr;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
        lastErr = new Error(`gmail api ${res.status}`);
        await sleep(waitMs, opts.signal);
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new Error(`gmail api ${res.status}: ${text.slice(0, 200)}`);
    }
    throw lastErr ?? new Error("gmail api: exhausted retries");
  }

  return {
    async listCategoryMessageIds(category, max) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      const pageSize = Math.min(max, 500);
      while (ids.length < max) {
        const qs = new URLSearchParams({
          labelIds: category,
          maxResults: String(pageSize),
        });
        if (pageToken) qs.set("pageToken", pageToken);
        const data = (await request(`/messages?${qs.toString()}`)) as {
          messages?: { id: string }[];
          nextPageToken?: string;
        };
        const page = data.messages ?? [];
        for (const m of page) {
          if (ids.length >= max) break;
          if (m.id) ids.push(m.id);
        }
        if (!data.nextPageToken || page.length === 0) break;
        pageToken = data.nextPageToken;
      }
      return ids;
    },

    async getMessageLabels(apiId) {
      const data = (await request(
        `/messages/${encodeURIComponent(apiId)}?format=minimal&fields=labelIds`,
      )) as { labelIds?: string[] };
      return data.labelIds ?? [];
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Gmail API returns message ids as lowercase hex; IMAP's X-GM-MSGID (imapflow's
 * `emailId`) is the same 64-bit integer encoded as decimal. Our `gmMsgid` column
 * stores the decimal form, so we convert hex → decimal at query time.
 */
export function apiIdToGmMsgid(hex: string): string {
  return BigInt("0x" + hex).toString(10);
}
