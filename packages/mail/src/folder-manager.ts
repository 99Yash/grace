import type { GraceDB } from "@grace/db";
import {
  startIdleSupervisor,
  type IdleSupervisor,
  type IdleSupervisorStatus,
} from "./idle-supervisor.ts";

export interface FolderManagerNewMessage {
  folder: string;
  gmMsgid: string;
  subject: string | null;
}

export interface FolderManagerOpts {
  email: string;
  clientId: string;
  clientSecret: string;
  db: GraceDB;
  /** Max concurrent IDLE supervisors. Gmail caps at 15 total IMAP conns;
   * leave headroom for action client + transient bootstrap/backfill. */
  maxConcurrent?: number;
  onNewMessage?: (info: FolderManagerNewMessage) => void;
  onStatus?: (status: IdleSupervisorStatus) => void;
  onError?: (err: unknown, ctx: { folder: string; attempt: number }) => void;
  debug?: boolean;
}

export interface EnsureResult {
  started: boolean;
  reason?: string;
}

export interface FolderManager {
  /** Start IDLE for a folder if not already running. Respects the cap. */
  ensure: (folderName: string) => EnsureResult;
  /** Stop IDLE for a folder. */
  release: (folderName: string) => Promise<void>;
  /** Folders currently being watched. */
  list: () => string[];
  /** Is this folder being watched? */
  has: (folderName: string) => boolean;
  /** Short-circuit backoff across all supervisors. Returns the number
   * that were actually kicked (i.e. were in the reconnecting state). */
  kickAll: (reason?: string) => number;
  stopAll: () => Promise<void>;
}

export const DEFAULT_MAX_CONCURRENT_IDLE = 4;

/**
 * Multiplies `startIdleSupervisor` across folders with a concurrency cap.
 * Gmail allows 15 concurrent IMAP connections; this manager reserves the
 * rest for the action client + transient bootstrap/backfill clients.
 */
export function startFolderManager(opts: FolderManagerOpts): FolderManager {
  const supervisors = new Map<string, IdleSupervisor>();
  const max = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_IDLE;

  const self: FolderManager = {
    ensure(folderName) {
      if (supervisors.has(folderName)) return { started: false };
      if (supervisors.size >= max) {
        return {
          started: false,
          reason: `idle supervisor cap (${max}) reached; skipping ${folderName}`,
        };
      }
      const supervisor = startIdleSupervisor({
        email: opts.email,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        db: opts.db,
        folderName,
        ...(opts.debug !== undefined ? { debug: opts.debug } : {}),
        ...(opts.onNewMessage
          ? {
              onNewMessage: ({ gmMsgid, subject }) =>
                opts.onNewMessage!({ folder: folderName, gmMsgid, subject }),
            }
          : {}),
        ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
        ...(opts.onError
          ? {
              onError: (err, ctx) =>
                opts.onError!(err, { folder: folderName, attempt: ctx.attempt }),
            }
          : {}),
      });
      supervisors.set(folderName, supervisor);
      return { started: true };
    },
    async release(folderName) {
      const s = supervisors.get(folderName);
      if (!s) return;
      supervisors.delete(folderName);
      await s.stop();
    },
    list: () => [...supervisors.keys()],
    has: (folderName) => supervisors.has(folderName),
    kickAll(reason) {
      let kicked = 0;
      for (const s of supervisors.values()) {
        if (s.kick(reason)) kicked++;
      }
      return kicked;
    },
    async stopAll() {
      const entries = [...supervisors.values()];
      supervisors.clear();
      await Promise.all(entries.map((s) => s.stop().catch(() => undefined)));
    },
  };

  return self;
}
