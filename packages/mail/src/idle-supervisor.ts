import type { ImapFlow } from "imapflow";
import { getFreshAccessToken } from "@grace/auth";
import type { GraceDB } from "@grace/db";
import { createImapClient } from "./imap.ts";
import { startIdleWorker, type IdleWorker } from "./idle.ts";

export type IdleSupervisorState =
  | "idle"
  | "connecting"
  | "watching"
  | "reconnecting"
  | "stopped";

export interface IdleSupervisorStatus {
  state: IdleSupervisorState;
  folder: string;
  attempt: number;
  delayMs?: number;
  reason?: string;
}

export interface IdleSupervisorOpts {
  email: string;
  clientId: string;
  clientSecret: string;
  db: GraceDB;
  folderName: string;
  onNewMessage?: (info: { gmMsgid: string; subject: string | null }) => void;
  onStatus?: (status: IdleSupervisorStatus) => void;
  onError?: (err: unknown, ctx: { attempt: number }) => void;
  debug?: boolean;
}

export interface IdleSupervisor {
  stop: () => Promise<void>;
  getStatus: () => IdleSupervisorStatus;
}

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 60_000];

function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
}

/**
 * Owns an IMAP client + IDLE worker and keeps it alive across disconnects.
 * On `close` events or connect/auth failures, reconnects with exponential
 * backoff (1s, 2s, 4s, 8s, 16s, 30s, 60s cap). Each attempt refreshes the
 * OAuth token so expiry during a long outage recovers cleanly.
 */
export function startIdleSupervisor(opts: IdleSupervisorOpts): IdleSupervisor {
  let status: IdleSupervisorStatus = {
    state: "idle",
    folder: opts.folderName,
    attempt: 0,
  };
  let stopped = false;
  let attempt = 0;
  let currentClient: ImapFlow | null = null;
  let currentWorker: IdleWorker | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (next: IdleSupervisorStatus) => {
    status = next;
    try {
      opts.onStatus?.(next);
    } catch (err) {
      console.error("[idle-supervisor] onStatus threw:", err);
    }
  };

  const cleanupCurrent = async () => {
    const worker = currentWorker;
    const client = currentClient;
    currentWorker = null;
    currentClient = null;
    if (worker) {
      try {
        await worker.stop();
      } catch {
        // ignore
      }
    } else if (client) {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  };

  const scheduleReconnect = (reason: string) => {
    if (stopped) return;
    if (reconnectTimer) return;
    const delay = backoffFor(attempt);
    attempt++;
    setStatus({
      state: "reconnecting",
      folder: opts.folderName,
      attempt,
      delayMs: delay,
      reason,
    });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectLoop();
    }, delay);
  };

  const connectLoop = async () => {
    if (stopped) return;
    await cleanupCurrent();
    setStatus({
      state: "connecting",
      folder: opts.folderName,
      attempt: attempt + 1,
    });
    let client: ImapFlow | null = null;
    try {
      const accessToken = await getFreshAccessToken({
        email: opts.email,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
      });
      client = createImapClient(
        opts.debug !== undefined
          ? { email: opts.email, accessToken, debug: opts.debug }
          : { email: opts.email, accessToken },
      );
      await client.connect();
      const worker = await startIdleWorker(
        opts.onNewMessage
          ? {
              client,
              db: opts.db,
              folderName: opts.folderName,
              onNewMessage: opts.onNewMessage,
            }
          : { client, db: opts.db, folderName: opts.folderName },
      );

      currentClient = client;
      currentWorker = worker;
      attempt = 0;
      setStatus({
        state: "watching",
        folder: opts.folderName,
        attempt: 0,
      });

      // Attach close handler only after watching is established.
      // On close, reschedule — unless we're shutting down or this client has
      // already been superseded (stop / another connect path).
      const onClose = () => {
        if (stopped) return;
        if (currentClient !== client) return;
        currentClient = null;
        currentWorker = null;
        scheduleReconnect("imap connection closed");
      };
      client.on("close", onClose);
    } catch (err) {
      try {
        opts.onError?.(err, { attempt: attempt + 1 });
      } catch (inner) {
        console.error("[idle-supervisor] onError threw:", inner);
      }
      if (client) {
        try {
          await client.logout();
        } catch {
          // ignore
        }
      }
      scheduleReconnect(err instanceof Error ? err.message : String(err));
    }
  };

  void connectLoop();

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await cleanupCurrent();
      setStatus({
        state: "stopped",
        folder: opts.folderName,
        attempt,
      });
    },
    getStatus: () => status,
  };
}
