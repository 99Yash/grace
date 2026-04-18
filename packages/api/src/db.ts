import { openDb, type GraceDB } from "@grace/db";
import { env } from "@grace/env/server";

let cached: GraceDB | undefined;

export function db(): GraceDB {
  if (!cached) cached = openDb(`${env().GRACE_DATA_DIR}/grace.db`).db;
  return cached;
}
