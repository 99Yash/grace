import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { getFreshAccessToken, loadActiveAccount } from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";
import { parseRecipients, sendMessage, type SendMessageAttachment } from "@grace/mail";
import { bus } from "../bus.ts";

function expandHome(raw: string): string {
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return `${homedir()}/${raw.slice(2)}`;
  return raw;
}

async function resolveAttachments(
  raw: string[] | undefined,
): Promise<{ ok: true; list: SendMessageAttachment[] } | { ok: false; error: string }> {
  if (!raw || raw.length === 0) return { ok: true, list: [] };
  const list: SendMessageAttachment[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const expanded = expandHome(trimmed);
    const abs = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
    try {
      const s = await stat(abs);
      if (!s.isFile()) return { ok: false, error: `not a file: ${trimmed}` };
    } catch {
      return { ok: false, error: `not found: ${trimmed}` };
    }
    list.push({ filename: basename(abs), path: abs });
  }
  return { ok: true, list };
}

export const sendRoutes = new Elysia().post(
  "/send",
  async ({ body, status }) => {
    const email = loadActiveAccount();
    if (!email) return status(401, { error: "not signed in" });

    const { valid, invalid } = parseRecipients(body.to);
    if (valid.length === 0) {
      return status(400, {
        error: "no valid recipients",
        invalid,
      });
    }
    if (invalid.length > 0) {
      return status(400, {
        error: `invalid recipient(s): ${invalid.join(", ")}`,
        invalid,
      });
    }

    const cc = parseRecipients(body.cc ?? "");
    if (cc.invalid.length > 0) {
      return status(400, {
        error: `invalid Cc: ${cc.invalid.join(", ")}`,
        invalid: cc.invalid,
      });
    }
    const bcc = parseRecipients(body.bcc ?? "");
    if (bcc.invalid.length > 0) {
      return status(400, {
        error: `invalid Bcc: ${bcc.invalid.join(", ")}`,
        invalid: bcc.invalid,
      });
    }

    const subject = body.subject.trim();
    if (subject.length === 0) return status(400, { error: "subject required" });
    if (body.text.trim().length === 0) return status(400, { error: "body required" });

    const attach = await resolveAttachments(body.attachments);
    if (!attach.ok) return status(400, { error: `attachment ${attach.error}` });

    try {
      const { clientId, clientSecret } = requireGoogleOAuth();
      const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });
      const res = await sendMessage({
        email,
        accessToken,
        to: valid,
        ...(cc.valid.length > 0 ? { cc: cc.valid } : {}),
        ...(bcc.valid.length > 0 ? { bcc: bcc.valid } : {}),
        subject,
        text: body.text,
        ...(body.inReplyTo ? { inReplyTo: body.inReplyTo } : {}),
        ...(body.references && body.references.length > 0 ? { references: body.references } : {}),
        ...(attach.list.length > 0 ? { attachments: attach.list } : {}),
      });
      bus.publish({
        type: "mail.sent",
        to: res.accepted,
        subject,
        messageId: res.messageId,
      });
      return {
        ok: true,
        messageId: res.messageId,
        accepted: res.accepted,
        rejected: res.rejected,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[send] failed:", message);
      return status(502, { error: message });
    }
  },
  {
    body: t.Object({
      to: t.String(),
      cc: t.Optional(t.String()),
      bcc: t.Optional(t.String()),
      subject: t.String(),
      text: t.String(),
      inReplyTo: t.Optional(t.String()),
      references: t.Optional(t.Array(t.String())),
      attachments: t.Optional(t.Array(t.String())),
    }),
  },
);
