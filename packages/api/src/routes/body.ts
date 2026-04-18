import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { bodies, folders, messages } from "@grace/db";
import { env } from "@grace/env/server";
import { deriveTextFromHtml, fetchMessageBody, isTextUseful } from "@grace/mail";
import { bus } from "../bus.ts";
import { db } from "../db.ts";
import { withActionClient } from "../imap-action.ts";

export const bodyRoutes = new Elysia().get(
  "/messages/:gmMsgid/body",
  async ({ params, status }) => {
    const { gmMsgid } = params;

    const msg = db()
      .select({
        folderId: messages.folderId,
        uid: messages.uid,
        read: messages.read,
      })
      .from(messages)
      .where(eq(messages.gmMsgid, gmMsgid))
      .get();
    if (!msg) return status(404, { error: "message not found in local cache" });

    if (!msg.read) {
      db().update(messages).set({ read: true }).where(eq(messages.gmMsgid, gmMsgid)).run();
      bus.publish({ type: "mail.updated", gmMsgid });
    }

    const folder = db()
      .select({ name: folders.name })
      .from(folders)
      .where(eq(folders.id, msg.folderId))
      .get();
    if (!folder) return status(500, { error: "folder row missing for message" });

    const cached = db().select().from(bodies).where(eq(bodies.gmMsgid, gmMsgid)).get();
    if (cached) {
      const html =
        cached.htmlPath !== null ? safeReadUtf8(cached.htmlPath) : null;
      let text = cached.text;
      if (!isTextUseful(text)) {
        const derived = deriveTextFromHtml(html);
        if (derived) {
          text = derived;
          db().update(bodies).set({ text }).where(eq(bodies.gmMsgid, gmMsgid)).run();
        }
      }
      return {
        gmMsgid,
        text,
        html,
        htmlPath: cached.htmlPath,
        rawPath: cached.rawPath,
        attachments: [] as AttachmentOut[],
        sizeBytes: cached.sizeBytes,
        cached: true,
      };
    }

    const bodiesDir = `${env().GRACE_DATA_DIR}/bodies`;
    const fetched = await withActionClient((client) =>
      fetchMessageBody({
        client,
        folderName: folder.name,
        gmMsgid,
        uid: msg.uid,
        bodiesDir,
      }),
    );

    db()
      .insert(bodies)
      .values({
        gmMsgid: fetched.gmMsgid,
        text: fetched.text,
        htmlPath: fetched.htmlPath,
        rawPath: fetched.rawPath,
        fetchedAt: new Date(),
        sizeBytes: fetched.sizeBytes,
      })
      .onConflictDoNothing()
      .run();

    return {
      gmMsgid: fetched.gmMsgid,
      text: fetched.text,
      html: fetched.html,
      htmlPath: fetched.htmlPath,
      rawPath: fetched.rawPath,
      attachments: fetched.attachments,
      sizeBytes: fetched.sizeBytes,
      cached: false,
    };
  },
  {
    params: t.Object({
      gmMsgid: t.String(),
    }),
  },
);

type AttachmentOut = {
  filename: string | null;
  contentType: string;
  size: number;
};

function safeReadUtf8(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
