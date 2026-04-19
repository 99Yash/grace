import { Elysia, t } from "elysia";
import { getFreshAccessToken, loadActiveAccount } from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";
import { parseRecipients, sendMessage } from "@grace/mail";
import { bus } from "../bus.ts";

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
        ...(body.references && body.references.length > 0
          ? { references: body.references }
          : {}),
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
    }),
  },
);
