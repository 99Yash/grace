import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT =
  process.env.GRACE_DATA_DIR ??
  `${process.env.HOME ?? "."}/.grace`;
const DB_PATH = join(ROOT, "tui.db");

let db: Database | undefined;
let getStmt: ReturnType<Database["prepare"]> | undefined;
let setStmt: ReturnType<Database["prepare"]> | undefined;
let delStmt: ReturnType<Database["prepare"]> | undefined;

function open(): Database | undefined {
  if (db) return db;
  try {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    const d = new Database(DB_PATH);
    d.exec("PRAGMA journal_mode = WAL;");
    d.exec("PRAGMA synchronous = NORMAL;");
    d.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    getStmt = d.prepare("SELECT v FROM kv WHERE k = ?");
    setStmt = d.prepare(
      "INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at",
    );
    delStmt = d.prepare("DELETE FROM kv WHERE k = ?");
    db = d;
    return d;
  } catch {
    return undefined;
  }
}

export function readCache<T>(key: string): T | null {
  try {
    if (!open() || !getStmt) return null;
    const row = getStmt.get(key) as { v: string } | null;
    if (!row) return null;
    return JSON.parse(row.v) as T;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    if (!open() || !setStmt) return;
    setStmt.run(key, JSON.stringify(value), Date.now());
  } catch {
    // best-effort; cache failures never crash the app
  }
}

export function deleteCache(key: string): void {
  try {
    if (!open() || !delStmt) return;
    delStmt.run(key);
  } catch {
    // best-effort
  }
}
