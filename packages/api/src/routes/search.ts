import { eq, inArray, or, like, desc } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { folders, messages } from "@grace/db";
import { db } from "../db.ts";
import { withActionClient } from "../imap-action.ts";

export interface SearchHit {
  phase: "local" | "remote";
  inLocal: boolean;
  gmMsgid: string;
  gmThrid: string | null;
  folder: string;
  uid: number;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  date: number;
  read: boolean;
  starred: boolean;
  labels: string[];
}

const SEARCH_FOLDER = "INBOX";
const LOCAL_LIMIT = 20;
const REMOTE_UID_CAP = 50;

export const searchRoutes = new Elysia({ prefix: "/search" }).get(
  "/",
  ({ query, request }) => {
    const q = (query.q ?? "").trim();
    const encoder = new TextEncoder();
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // controller may already be closed
          }
        };
        const emit = (event: string, data: unknown) => {
          write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        write(":ok\n\n");

        if (!q) {
          emit("done", { reason: "empty-query" });
          controller.close();
          return;
        }

        const folder = db().select().from(folders).where(eq(folders.name, SEARCH_FOLDER)).get();
        if (!folder) {
          emit("error", { message: `folder ${SEARCH_FOLDER} not indexed yet` });
          controller.close();
          return;
        }

        // Phase 1: local LIKE search.
        const seen = new Set<string>();
        try {
          const pat = `%${q}%`;
          const rows = db()
            .select()
            .from(messages)
            .where(
              or(
                like(messages.subject, pat),
                like(messages.fromName, pat),
                like(messages.fromEmail, pat),
                like(messages.snippet, pat),
              ),
            )
            .orderBy(desc(messages.date))
            .limit(LOCAL_LIMIT)
            .all();

          for (const r of rows) {
            seen.add(r.gmMsgid);
            emit("hit", serializeLocal(r, SEARCH_FOLDER, "local"));
          }
        } catch (err) {
          emit("error", { phase: "local", message: errMsg(err) });
        }

        emit("phase", { phase: "local-done", localHits: seen.size });

        if (abort.signal.aborted) {
          controller.close();
          return;
        }

        // Phase 2: Gmail remote search.
        try {
          await withActionClient(async (client) => {
            const lock = await client.getMailboxLock(SEARCH_FOLDER);
            try {
              const uids = ((await client.search(
                { gmRaw: q } as unknown as Parameters<typeof client.search>[0],
                { uid: true },
              )) ?? []) as number[];
              if (uids.length === 0) return;

              const slice = uids.slice(-REMOTE_UID_CAP);
              for await (const msg of client.fetch(
                slice,
                {
                  uid: true,
                  envelope: true,
                  flags: true,
                  labels: true,
                  threadId: true,
                  emailId: true,
                } as unknown as Record<string, boolean>,
                { uid: true },
              )) {
                if (abort.signal.aborted) break;
                const gmMsgid = (msg as { emailId?: string }).emailId;
                if (!gmMsgid || seen.has(gmMsgid)) continue;

                const env = msg.envelope;
                const from = env?.from?.[0] as
                  | { name?: string; mailbox?: string; host?: string }
                  | undefined;
                const flagSet = Array.from(msg.flags ?? []);
                const labelSet = Array.from((msg as { labels?: Set<string> }).labels ?? []);
                const inLocal = !!db()
                  .select({ g: messages.gmMsgid })
                  .from(messages)
                  .where(eq(messages.gmMsgid, gmMsgid))
                  .get();

                seen.add(gmMsgid);
                const hit: SearchHit = {
                  phase: "remote",
                  inLocal,
                  gmMsgid,
                  gmThrid: (msg as { threadId?: string }).threadId ?? null,
                  folder: SEARCH_FOLDER,
                  uid: Number(msg.uid),
                  subject: env?.subject ?? null,
                  fromName: from?.name ?? null,
                  fromEmail:
                    from && from.mailbox && from.host ? `${from.mailbox}@${from.host}` : null,
                  date: env?.date ? new Date(env.date).getTime() : Date.now(),
                  read: flagSet.includes("\\Seen"),
                  starred: flagSet.includes("\\Flagged"),
                  labels: labelSet,
                };
                emit("hit", hit);
              }
            } finally {
              lock.release();
            }
          });
        } catch (err) {
          emit("error", { phase: "remote", message: errMsg(err) });
        }

        emit("done", { total: seen.size });
        controller.close();
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
  {
    query: t.Object({
      q: t.Optional(t.String()),
    }),
  },
);

function serializeLocal(
  r: typeof messages.$inferSelect,
  folderName: string,
  _phase: "local",
): SearchHit {
  return {
    phase: "local",
    inLocal: true,
    gmMsgid: r.gmMsgid,
    gmThrid: r.gmThrid,
    folder: folderName,
    uid: r.uid,
    subject: r.subject,
    fromName: r.fromName,
    fromEmail: r.fromEmail,
    date: r.date instanceof Date ? r.date.getTime() : Number(r.date),
    read: r.read,
    starred: r.starred,
    labels: safeJsonArray(r.labels),
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
