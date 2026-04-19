import { loadActiveAccount } from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";
import {
  startFolderManager,
  type FolderManager,
  type IdleSupervisorStatus,
} from "@grace/mail";
import { bus } from "./bus.ts";
import { db } from "./db.ts";

let manager: FolderManager | null = null;

/** Returns the singleton folder-manager, minting one lazily if an account
 * is signed in. Returns null when no active account — callers should handle
 * that case (the server retries on `auth.signed-in`). */
export function getFolderManager(): FolderManager | null {
  if (manager) return manager;
  const email = loadActiveAccount();
  if (!email) return null;
  const { clientId, clientSecret } = requireGoogleOAuth();

  manager = startFolderManager({
    email,
    clientId,
    clientSecret,
    db: db(),
    debug: process.env.GRACE_IMAP_DEBUG === "1",
    onNewMessage: ({ folder, gmMsgid, subject }) => {
      console.log(`[idle:${folder}] new message: ${subject ?? "(no subject)"}`);
      bus.publish({ type: "mail.received", folder, gmMsgid, subject });
    },
    onStatus: (s: IdleSupervisorStatus) => {
      const state = s.state === "idle" ? "connecting" : s.state;
      bus.publish({
        type: "idle.status",
        state,
        folder: s.folder,
        attempt: s.attempt,
        ...(s.delayMs !== undefined ? { delayMs: s.delayMs } : {}),
        ...(s.reason !== undefined ? { reason: s.reason } : {}),
      });
      if (s.state === "watching") {
        console.log(`[idle:${s.folder}] watching`);
      } else if (s.state === "reconnecting") {
        console.log(
          `[idle:${s.folder}] reconnecting in ${Math.round((s.delayMs ?? 0) / 100) / 10}s · attempt ${s.attempt} · ${s.reason ?? ""}`,
        );
      }
    },
    onError: (err, ctx) => {
      console.error(
        `[idle:${ctx.folder}] attempt ${ctx.attempt} failed:`,
        formatImapError(err),
      );
    },
  });
  return manager;
}

/** Ensure IDLE is running for a folder. Returns a short message describing
 * the result, or null if the manager isn't ready (no active account). */
export function ensureFolderIdle(folderName: string): string | null {
  const m = getFolderManager();
  if (!m) return null;
  const { started, reason } = m.ensure(folderName);
  if (started) return `started IDLE for ${folderName}`;
  if (reason) return reason;
  return `already watching ${folderName}`;
}

export async function stopFolderManager(): Promise<void> {
  if (!manager) return;
  const m = manager;
  manager = null;
  await m.stopAll();
}

export function watchedFolders(): string[] {
  return manager?.list() ?? [];
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
