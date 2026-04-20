import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  // IMAP/SMTP over XOAUTH2 requires this specific "full access" scope.
  // It supersedes gmail.modify + gmail.send + gmail.readonly.
  "https://mail.google.com/",
] as const;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  idToken?: string | undefined;
}

export interface LoginFlowOpts {
  clientId: string;
  clientSecret: string;
  onOpenUrl: (url: string) => void | Promise<void>;
}

export async function runLoginFlow(opts: LoginFlowOpts): Promise<TokenSet> {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const { port, waitForCode, close } = await startLoopbackServer(state);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const client = new OAuth2Client(opts.clientId, opts.clientSecret, redirectUri);

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GMAIL_SCOPES],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as never,
  });

  try {
    await opts.onOpenUrl(url);
    const code = await waitForCode;
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.access_token) throw new Error("Google did not return an access_token");
    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh_token. Revoke the app at https://myaccount.google.com/permissions and retry.",
      );
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ?? Date.now() + 3_600_000,
      scope: tokens.scope ?? GMAIL_SCOPES.join(" "),
      idToken: tokens.id_token ?? undefined,
    };
  } finally {
    close();
  }
}

function startLoopbackServer(expectedState: string) {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (reqUrl.pathname !== "/callback") {
      res.writeHead(404).end("Not found");
      return;
    }
    const code = reqUrl.searchParams.get("code");
    const state = reqUrl.searchParams.get("state");
    const error = reqUrl.searchParams.get("error");
    if (error) {
      finish(res, 400, `<h1>grace · sign-in failed</h1><p>${escapeHtml(error)}</p>`);
      rejectCode(new Error(`OAuth error: ${error}`));
      return;
    }
    if (!state || state !== expectedState) {
      finish(res, 400, "<h1>grace · state mismatch</h1><p>Possible CSRF — try again.</p>");
      rejectCode(new Error("OAuth state mismatch"));
      return;
    }
    if (!code) {
      finish(res, 400, "<h1>grace · missing code</h1>");
      rejectCode(new Error("OAuth response missing code"));
      return;
    }
    finish(
      res,
      200,
      `<!doctype html><html><body style="font-family:system-ui;padding:3rem;color:#222;">
        <h1>grace · signed in ✓</h1>
        <p>You can close this tab and return to your terminal.</p>
      </body></html>`,
    );
    resolveCode(code);
  });

  return new Promise<{ port: number; waitForCode: Promise<string>; close: () => void }>(
    (resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        resolve({
          port: addr.port,
          waitForCode,
          close: () => server.close(),
        });
      });
    },
  );
}

function finish(res: import("node:http").ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function decodeIdToken(idToken: string): { email?: string; sub?: string; name?: string } {
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) return {};
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}
