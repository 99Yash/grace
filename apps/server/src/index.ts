import { cors } from "@elysiajs/cors";
import {
  app,
  bus,
  ensureFolderIdle,
  getCapabilities,
  maybeSyncCategories,
  startNetworkMonitorSingleton,
  stopFolderManager,
  stopNetworkMonitorSingleton,
  watchedFolders,
} from "@grace/api";
import { loadActiveAccount } from "@grace/auth";
import { openDb } from "@grace/db";
import { env, requireGoogleOAuth } from "@grace/env/server";
import { runBackfill } from "@grace/mail";
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

async function shutdownExistingDaemon(): Promise<void> {
  try {
    await fetch(`http://${GRACE_HOST}:${GRACE_PORT}/api/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // connection reset is expected — the old process is dying
  }
  // wait for the port to be released
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (!(await probeExistingDaemon())) return;
  }
  throw new Error("failed to shut down existing grace daemon — kill it manually");
}

if (await probeExistingDaemon()) {
  console.log(
    `grace daemon already running on http://${GRACE_HOST}:${GRACE_PORT} — shutting it down…`,
  );
  await shutdownExistingDaemon();
}

openDb(`${GRACE_DATA_DIR}/grace.db`);
getCapabilities();

const backfillStarted = new Set<string>();
const backfillAbort = new AbortController();

function kickBackfill(folderName: string): void {
  if (backfillStarted.has(folderName)) return;
  const email = loadActiveAccount();
  if (!email) return;
  const { clientId, clientSecret } = requireGoogleOAuth();
  const { db } = openDb(`${GRACE_DATA_DIR}/grace.db`);
  backfillStarted.add(folderName);
  void runBackfill({
    email,
    clientId,
    clientSecret,
    db,
    folderName,
    signal: backfillAbort.signal,
    onProgress: (done, target) => {
      bus.publish({ type: "folder.sync.progress", folder: folderName, done, target });
    },
  })
    .then(() => maybeSyncCategories(folderName))
    .catch((err) => {
      backfillStarted.delete(folderName);
      console.error(`[backfill:${folderName}] failed:`, err instanceof Error ? err.message : err);
    });
}

function ensureInboxIdle(): void {
  const result = ensureFolderIdle("INBOX");
  if (result === null) {
    console.log("[idle] skipped — no active account. sign in via the TUI.");
    return;
  }
  kickBackfill("INBOX");
}

const server = new Elysia()
  .use(cors({ origin: true, credentials: true }))
  .use(app)
  .listen({ hostname: GRACE_HOST, port: GRACE_PORT }, () => {
    console.log(`grace daemon listening on http://${GRACE_HOST}:${GRACE_PORT}`);
  });

ensureInboxIdle();
startNetworkMonitorSingleton();

bus.subscribe((e) => {
  if (e.type === "auth.signed-in" && watchedFolders().length === 0) {
    ensureInboxIdle();
  }
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  backfillAbort.abort();
  stopNetworkMonitorSingleton();
  await stopFolderManager();
  await server.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
