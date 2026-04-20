import { Elysia, t } from "elysia";
import { folders } from "@grace/db";
import { listFolders, type FolderEntry } from "@grace/mail";
import { db } from "../db.ts";
import { withActionClient } from "../imap-action.ts";

interface FolderDTO {
  path: string;
  name: string;
  specialUse: string | null;
  noSelect: boolean;
  messages: number | null;
  unseen: number | null;
  /** true when we have this folder row in SQLite (so local reads work). */
  tracked: boolean;
}

let cached: { at: number; data: FolderDTO[] } | null = null;
const CACHE_TTL_MS = 60_000;

export const folderRoutes = new Elysia({ prefix: "/folders" }).get(
  "/",
  async ({ query, status }) => {
    const refresh = query.refresh === "true" || query.refresh === "1";
    if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { folders: cached.data, fromCache: true };
    }
    try {
      const entries = await withActionClient((client) => listFolders(client));
      const trackedNames = new Set(
        db()
          .select({ n: folders.name })
          .from(folders)
          .all()
          .map((r) => r.n),
      );
      const data = entries.map((e) => toDTO(e, trackedNames.has(e.path)));
      cached = { at: Date.now(), data };
      return { folders: data, fromCache: false };
    } catch (err) {
      const tracked = db().select().from(folders).all();
      if (tracked.length === 0) {
        return status(502, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const data = tracked.map<FolderDTO>((f) => ({
        path: f.name,
        name: f.name.split("/").pop() ?? f.name,
        specialUse: null,
        noSelect: false,
        messages: null,
        unseen: null,
        tracked: true,
      }));
      return { folders: data, fromCache: false, degraded: true };
    }
  },
  {
    query: t.Object({
      refresh: t.Optional(t.String()),
    }),
  },
);

function toDTO(e: FolderEntry, tracked: boolean): FolderDTO {
  return {
    path: e.path,
    name: e.name,
    specialUse: e.specialUse,
    noSelect: e.noSelect,
    messages: e.messages,
    unseen: e.unseen,
    tracked,
  };
}
