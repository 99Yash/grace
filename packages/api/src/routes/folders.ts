import { Elysia } from "elysia";
import { folders } from "@grace/db";
import { db } from "../db.ts";

export const folderRoutes = new Elysia({ prefix: "/folders" }).get("/", () => {
  const rows = db().select().from(folders).all();
  return {
    folders: rows.map((f) => ({
      id: f.id,
      name: f.name,
      uidValidity: f.uidValidity,
      highestModseq: f.highestModseq,
      lastSyncedAt: f.lastSyncedAt instanceof Date ? f.lastSyncedAt.getTime() : f.lastSyncedAt,
    })),
  };
});
