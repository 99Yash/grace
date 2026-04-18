import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { folders, messages } from "@grace/db";
import { db } from "../db.ts";

export const importRoutes = new Elysia({ prefix: "/messages" }).post(
  "/import",
  ({ body, status }) => {
    const hit = body;

    const folder = db().select().from(folders).where(eq(folders.name, hit.folder)).get();
    if (!folder) return status(400, { error: `folder ${hit.folder} not indexed` });

    db()
      .insert(messages)
      .values({
        gmMsgid: hit.gmMsgid,
        gmThrid: hit.gmThrid,
        folderId: folder.id,
        uid: hit.uid,
        subject: hit.subject,
        fromName: hit.fromName,
        fromEmail: hit.fromEmail,
        date: new Date(hit.date),
        snippet: null,
        flags: JSON.stringify([]),
        labels: JSON.stringify(hit.labels),
        read: hit.read,
        starred: hit.starred,
      })
      .onConflictDoNothing()
      .run();

    return { gmMsgid: hit.gmMsgid, imported: true };
  },
  {
    body: t.Object({
      gmMsgid: t.String(),
      gmThrid: t.Union([t.String(), t.Null()]),
      folder: t.String(),
      uid: t.Number(),
      subject: t.Union([t.String(), t.Null()]),
      fromName: t.Union([t.String(), t.Null()]),
      fromEmail: t.Union([t.String(), t.Null()]),
      date: t.Number(),
      read: t.Boolean(),
      starred: t.Boolean(),
      labels: t.Array(t.String()),
    }),
  },
);
