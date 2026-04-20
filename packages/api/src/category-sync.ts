import { loadActiveAccount } from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";
import { syncCategories } from "@grace/mail";
import { bus } from "./bus.ts";
import { db } from "./db.ts";

const STALE_MS = 5 * 60 * 1000;

const lastSyncedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Kicks off a Gmail-API-backed category sync for a folder, unless one has run
 * within the last 5 minutes (or is currently in flight). Fire-and-forget:
 * callers don't await. Emits `mail.updated` per row changed so the TUI
 * re-renders.
 */
export function maybeSyncCategories(folderName: string): void {
  if (folderName !== "INBOX") return; // categories only meaningful on INBOX for now
  const now = Date.now();
  const last = lastSyncedAt.get(folderName) ?? 0;
  if (now - last < STALE_MS) return;
  if (inFlight.has(folderName)) return;

  const email = loadActiveAccount();
  if (!email) return;
  const { clientId, clientSecret } = requireGoogleOAuth();

  const p = (async () => {
    try {
      const res = await syncCategories({
        db: db(),
        folderName,
        email,
        clientId,
        clientSecret,
        onLabelChange: (gmMsgid) => bus.publish({ type: "mail.updated", gmMsgid }),
      });
      lastSyncedAt.set(folderName, Date.now());
      console.log(
        `[categories] ${folderName} · labeled=${res.labeled} fetched=${res.fetchedIds} in ${res.durationMs}ms`,
      );
    } catch (err) {
      console.warn(
        `[categories] ${folderName} sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      inFlight.delete(folderName);
    }
  })();
  inFlight.set(folderName, p);
}

/** Test seam — lets us force a resync regardless of cadence. */
export function resetCategorySync(): void {
  lastSyncedAt.clear();
  inFlight.clear();
}
