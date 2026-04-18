import { cors } from "@elysiajs/cors";
import { app, bus, getCapabilities } from "@grace/api";
import { getFreshAccessToken, loadActiveAccount } from "@grace/auth";
import { openDb } from "@grace/db";
import { env, requireGoogleOAuth } from "@grace/env/server";
import {
  createImapClient,
  runBackfill,
  startIdleWorker,
  type IdleWorker,
} from "@grace/mail";
import { Elysia } from "elysia";

const { GRACE_HOST, GRACE_PORT, GRACE_DATA_DIR } = env();

async function probeExistingDaemon(): Promise<boolean> {
  try {
    const res = await fetch(`http://${GRACE_HOST}:${GRACE_PORT}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { name?: string };
    return body?.name === "grace";
  } catch {
    return false;
  }
}

if (await probeExistingDaemon()) {
  console.log(
    `grace daemon already running on http://${GRACE_HOST}:${GRACE_PORT} — exiting this instance to avoid duplicate IDLE connections`,
  );
  process.exit(0);
}

openDb(`${GRACE_DATA_DIR}/grace.db`);
getCapabilities();

let idleWorker: IdleWorker | null = null;
const backfillAbort = new AbortController();

async function startIdleIfPossible(): Promise<void> {
  const email = loadActiveAccount();
  if (!email) {
    console.log("[idle] skipped — no active account. run `bun run oauth:login`.");
    return;
  }
  try {
    const { clientId, clientSecret } = requireGoogleOAuth();
    const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });
    const client = createImapClient({ email, accessToken, debug: process.env.GRACE_IMAP_DEBUG === "1" });
    await client.connect();
    const { db } = openDb(`${GRACE_DATA_DIR}/grace.db`);
    idleWorker = await startIdleWorker({
      client,
      db,
      folderName: "INBOX",
      onNewMessage: ({ gmMsgid, subject }) => {
        console.log(`[idle] new message: ${subject ?? "(no subject)"}`);
        bus.publish({ type: "mail.received", folder: "INBOX", gmMsgid, subject });
      },
    });
    console.log(`[idle] watching INBOX for ${email}`);

    void runBackfill({
      email,
      clientId,
      clientSecret,
      db,
      folderName: "INBOX",
      signal: backfillAbort.signal,
      onProgress: (done, target) => {
        bus.publish({ type: "folder.sync.progress", folder: "INBOX", done, target });
      },
    }).catch((err) => {
      console.error("[backfill] failed:", err instanceof Error ? err.message : err);
    });
  } catch (err) {
    console.error("[idle] failed to start:", formatImapError(err));
  }
}

function formatImapError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & {
    responseText?: string;
    serverResponseCode?: string;
    authenticationFailed?: boolean;
  };
  const parts: string[] = [e.message];
  if (e.responseText) parts.push(`response="${e.responseText}"`);
  if (e.serverResponseCode) parts.push(`code=${e.serverResponseCode}`);
  if (e.authenticationFailed) parts.push("auth-failed");
  if (
    e.responseText &&
    /too many simultaneous connections/i.test(e.responseText)
  ) {
    parts.push("(Gmail 15-conn cap — wait ~60s and restart, or kill stale bun processes)");
  }
  return parts.join(" · ");
}

const server = new Elysia()
  .use(cors({ origin: true, credentials: true }))
  .use(app)
  .listen({ hostname: GRACE_HOST, port: GRACE_PORT }, () => {
    console.log(`grace daemon listening on http://${GRACE_HOST}:${GRACE_PORT}`);
  });

void startIdleIfPossible();

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  backfillAbort.abort();
  if (idleWorker) {
    await idleWorker.stop();
    idleWorker = null;
  }
  await server.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
