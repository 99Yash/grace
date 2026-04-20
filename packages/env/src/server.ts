import { z } from "zod";
import { DAEMON_DEFAULT_HOST, DAEMON_DEFAULT_PORT } from "./index.ts";

const schema = z.object({
  GRACE_HOST: z.string().default(DAEMON_DEFAULT_HOST),
  GRACE_PORT: z.coerce.number().int().positive().default(DAEMON_DEFAULT_PORT),
  GRACE_DATA_DIR: z.string().default(`${process.env.HOME ?? "."}/.grace`),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function requireGoogleOAuth(): {
  clientId: string;
  clientSecret: string;
} {
  const e = env();
  if (!e.GOOGLE_OAUTH_CLIENT_ID || !e.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error(
      "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET. Copy .env.example to .env and fill in the GCP credentials.",
    );
  }
  return {
    clientId: e.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET,
  };
}
