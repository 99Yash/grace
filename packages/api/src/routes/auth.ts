import { Elysia } from "elysia";
import {
  decodeIdToken,
  loadActiveAccount,
  loadTokens,
  runLoginFlow,
  saveActiveAccount,
  saveTokens,
} from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";
import { bus } from "../bus.ts";

let loginInFlight: Promise<{ email: string }> | null = null;

async function performLogin(): Promise<{ email: string }> {
  const { clientId, clientSecret } = requireGoogleOAuth();
  const tokens = await runLoginFlow({
    clientId,
    clientSecret,
    onOpenUrl: (url) => {
      const cmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      try {
        Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
      } catch {
        // fall through — URL still logged below
      }
      console.log(`[auth] if the browser didn't open, paste this URL:\n  ${url}`);
    },
  });
  const { email } = tokens.idToken ? decodeIdToken(tokens.idToken) : {};
  if (!email) throw new Error("Google did not return an email in id_token");
  saveTokens(email, tokens);
  saveActiveAccount(email);
  bus.publish({ type: "auth.signed-in", email });
  console.log(`[auth] signed in as ${email}`);
  return { email };
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .get("/status", () => {
    const email = loadActiveAccount();
    if (!email) return { signedIn: false as const };
    const tokens = loadTokens(email);
    if (!tokens) return { signedIn: false as const };
    return { signedIn: true as const, email, expiresAt: tokens.expiresAt };
  })
  .post("/login", async ({ set }) => {
    if (loginInFlight) {
      try {
        return await loginInFlight;
      } catch {
        // previous attempt failed — fall through and start fresh
      }
    }
    const p = performLogin();
    loginInFlight = p;
    try {
      return await p;
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (loginInFlight === p) loginInFlight = null;
    }
  });
