import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.ts";

export type GraceDB = BunSQLiteDatabase<typeof schema>;

interface Handle {
  db: GraceDB;
  sqlite: Database;
}

let handle: Handle | undefined;

export function openDb(path: string): Handle {
  if (handle) return handle;
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  ensureTables(sqlite);
  const db = drizzle(sqlite, { schema });
  handle = { db, sqlite };
  return handle;
}

export function ensureTables(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      uid_validity INTEGER,
      highest_modseq TEXT,
      last_synced_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      gm_msgid TEXT PRIMARY KEY,
      gm_thrid TEXT,
      folder_id INTEGER NOT NULL REFERENCES folders(id),
      uid INTEGER NOT NULL,
      subject TEXT,
      from_name TEXT,
      from_email TEXT,
      date INTEGER NOT NULL,
      snippet TEXT,
      flags TEXT NOT NULL DEFAULT '[]',
      labels TEXT NOT NULL DEFAULT '[]',
      read INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS messages_folder_date_idx ON messages(folder_id, date DESC);
    CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(gm_thrid);
    CREATE TABLE IF NOT EXISTS bodies (
      gm_msgid TEXT PRIMARY KEY REFERENCES messages(gm_msgid) ON DELETE CASCADE,
      text TEXT,
      html_path TEXT,
      raw_path TEXT,
      fetched_at INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL
    );
  `);
}
