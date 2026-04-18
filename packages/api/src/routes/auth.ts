import { Elysia } from "elysia";
import { loadActiveAccount, loadTokens } from "@grace/auth";

export const authRoutes = new Elysia({ prefix: "/auth" }).get("/status", () => {
  const email = loadActiveAccount();
  if (!email) return { signedIn: false as const };
  const tokens = loadTokens(email);
  if (!tokens) return { signedIn: false as const };
  return { signedIn: true as const, email, expiresAt: tokens.expiresAt };
});
