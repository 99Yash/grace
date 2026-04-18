import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { folders, messages } from "@grace/db";
import { applyMutation, type MutationAction } from "@grace/mail";
import { bus } from "../bus.ts";
import { db } from "../db.ts";
import { withActionClient } from "../imap-action.ts";

export const mutateRoutes = new Elysia().post(
  "/messages/:gmMsgid/mutate",
  async ({ params, body, status }) => {
    const { gmMsgid } = params;

    const msg = db()
      .select({
        folderId: messages.folderId,
        uid: messages.uid,
        read: messages.read,
        starred: messages.starred,
      })
      .from(messages)
      .where(eq(messages.gmMsgid, gmMsgid))
      .get();
    if (!msg) return status(404, { error: "message not found in local cache" });

    const folder = db()
      .select({ name: folders.name })
      .from(folders)
      .where(eq(folders.id, msg.folderId))
      .get();
    if (!folder) return status(500, { error: "folder row missing for message" });

    const action = toMutationAction(body, msg);
    if (!action) return status(400, { error: "unknown action" });

    try {
      const result = await withActionClient((client) =>
        applyMutation(client, { folderName: folder.name, uid: msg.uid }, action),
      );

      if (result.removedFromSource) {
        db().delete(messages).where(eq(messages.gmMsgid, gmMsgid)).run();
      } else if (action.type === "read") {
        db().update(messages).set({ read: action.value }).where(eq(messages.gmMsgid, gmMsgid)).run();
      } else if (action.type === "star") {
        db()
          .update(messages)
          .set({ starred: action.value })
          .where(eq(messages.gmMsgid, gmMsgid))
          .run();
      }

      bus.publish({ type: "mail.updated", gmMsgid });
      return { ok: true, action: action.type, removed: result.removedFromSource };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mutate] ${action.type} failed for ${gmMsgid}:`, message);
      return status(502, { error: message });
    }
  },
  {
    params: t.Object({ gmMsgid: t.String() }),
    body: t.Object({
      action: t.Union([
        t.Literal("read"),
        t.Literal("unread"),
        t.Literal("star"),
        t.Literal("unstar"),
        t.Literal("toggle-read"),
        t.Literal("toggle-star"),
        t.Literal("archive"),
        t.Literal("trash"),
      ]),
    }),
  },
);

function toMutationAction(
  body: { action: string },
  current: { read: boolean; starred: boolean },
): MutationAction | null {
  switch (body.action) {
    case "read":
      return { type: "read", value: true };
    case "unread":
      return { type: "read", value: false };
    case "toggle-read":
      return { type: "read", value: !current.read };
    case "star":
      return { type: "star", value: true };
    case "unstar":
      return { type: "star", value: false };
    case "toggle-star":
      return { type: "star", value: !current.starred };
    case "archive":
      return { type: "archive" };
    case "trash":
      return { type: "trash" };
    default:
      return null;
  }
}
