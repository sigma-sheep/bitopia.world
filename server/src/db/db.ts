import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";

const here = dirname(fileURLToPath(import.meta.url));

// Opens (or creates) the SQLite db and applies the schema. The schema is written
// with CREATE TABLE IF NOT EXISTS, so this is safe to run on every boot.
export function openDb(path: string = config.dbPath): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return db;
}
