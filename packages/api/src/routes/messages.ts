import { desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { folders, messages } from "@grace/db";
import { db } from "../db.ts";

export const messageRoutes = new Elysia({ prefix: "/messages" }).get(
  "/",
  ({ query }) => {
    const folderName = query.folder ?? "INBOX";
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    const folder = db().select().from(folders).where(eq(folders.name, folderName)).get();
    if (!folder) {
      return { folder: folderName, messages: [], nextOffset: null as number | null };
    }

    const rows = db()
      .select()
      .from(messages)
      .where(eq(messages.folderId, folder.id))
      .orderBy(desc(messages.date))
      .limit(limit + 1)
      .offset(offset)
      .all();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      folder: folderName,
      messages: page.map((r) => ({
        gmMsgid: r.gmMsgid,
        gmThrid: r.gmThrid,
        subject: r.subject,
        fromName: r.fromName,
        fromEmail: r.fromEmail,
        date: r.date instanceof Date ? r.date.getTime() : (r.date as number),
        read: r.read,
        starred: r.starred,
        labels: safeJsonArray(r.labels),
      })),
      nextOffset: hasMore ? offset + limit : null,
    };
  },
  {
    query: t.Object({
      folder: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
    }),
  },
);

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
