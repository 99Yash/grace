import { OAuth2Client } from "google-auth-library";
import { loadTokens, saveTokens } from "./keychain.ts";
import type { TokenSet } from "./oauth.ts";

const SAFETY_WINDOW_MS = 60_000;

export interface RefreshOpts {
  clientId: string;
  clientSecret: string;
  email: string;
}

export async function getFreshAccessToken(opts: RefreshOpts): Promise<string> {
  const tokens = loadTokens(opts.email);
  if (!tokens) {
    throw new Error(`No tokens in keychain for ${opts.email}. Run \`bun run oauth:login\`.`);
  }
  if (tokens.expiresAt > Date.now() + SAFETY_WINDOW_MS) {
    return tokens.accessToken;
  }
  const client = new OAuth2Client(opts.clientId, opts.clientSecret);
  client.setCredentials({ refresh_token: tokens.refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Google refresh did not return an access_token");
  }
  const refreshed: TokenSet = {
    accessToken: credentials.access_token,
    refreshToken: credentials.refresh_token ?? tokens.refreshToken,
    expiresAt: credentials.expiry_date ?? Date.now() + 3_600_000,
    scope: credentials.scope ?? tokens.scope,
    idToken: credentials.id_token ?? tokens.idToken,
  };
  saveTokens(opts.email, refreshed);
  return refreshed.accessToken;
}
