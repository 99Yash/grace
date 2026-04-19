import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { folders, messages } from "@grace/db";
import { applyLabelChange } from "@grace/mail";
import { bus } from "../bus.ts";
import { db } from "../db.ts";
import { withActionClient } from "../imap-action.ts";

export const labelRoutes = new Elysia().post(
  "/messages/:gmMsgid/labels",
  async ({ params, body, status }) => {
    const { gmMsgid } = params;
    const add = dedupe(body.add ?? []);
    const remove = dedupe(body.remove ?? []);
    if (add.length === 0 && remove.length === 0) {
      return status(400, { error: "nothing to add or remove" });
    }

    const msg = db()
      .select({ folderId: messages.folderId, uid: messages.uid, labels: messages.labels })
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

    try {
      await withActionClient((client) =>
        applyLabelChange(client, { folderName: folder.name, uid: msg.uid }, { add, remove }),
      );

      const current = safeJsonArray(msg.labels);
      const removeSet = new Set(remove);
      const next = [...current.filter((l) => !removeSet.has(l))];
      for (const l of add) if (!next.includes(l)) next.push(l);

      db()
        .update(messages)
        .set({ labels: JSON.stringify(next) })
        .where(eq(messages.gmMsgid, gmMsgid))
        .run();

      bus.publish({ type: "mail.updated", gmMsgid });
      return { ok: true, labels: next };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[labels] mutation failed for ${gmMsgid}:`, message);
      return status(502, { error: message });
    }
  },
  {
    params: t.Object({ gmMsgid: t.String() }),
    body: t.Object({
      add: t.Optional(t.Array(t.String())),
      remove: t.Optional(t.Array(t.String())),
    }),
  },
);

function dedupe(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const v = s.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
