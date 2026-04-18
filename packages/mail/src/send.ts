import nodemailer from "nodemailer";

export interface SendMessageOpts {
  email: string;
  accessToken: string;
  to: string[];
  subject: string;
  text: string;
  fromName?: string;
}

export interface SendMessageResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export async function sendMessage(opts: SendMessageOpts): Promise<SendMessageResult> {
  const { email, accessToken, to, subject, text, fromName } = opts;

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      type: "OAuth2",
      user: email,
      accessToken,
    },
  });

  try {
    const info = await transport.sendMail({
      from: fromName ? `"${fromName}" <${email}>` : email,
      to,
      subject,
      text,
    });
    return {
      messageId: info.messageId,
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
    };
  } finally {
    transport.close();
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a comma-separated recipient list. Returns `{ valid, invalid }`. */
export function parseRecipients(raw: string): { valid: string[]; invalid: string[] } {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (EMAIL_RE.test(p)) valid.push(p);
    else invalid.push(p);
  }
  return { valid, invalid };
}
