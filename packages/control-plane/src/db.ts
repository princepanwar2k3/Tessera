import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The registry's storage. SQLite because the control plane is the one piece
 * that must survive a restart with its provider list intact — a daemon can
 * rebuild from its own job files, but a judge reloading the console after a
 * redeploy must still see the machines.
 *
 * `:memory:` is a first-class option, and the tests use it.
 */
export function openDatabase(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  // WAL survives an unclean shutdown without a corrupt file, which is exactly
  // the failure this deployment is most likely to hit.
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      provider_id   TEXT PRIMARY KEY,
      endpoint      TEXT NOT NULL,
      registered_at INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      active_jobs   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS machines (
      machine_id   TEXT PRIMARY KEY,
      provider_id  TEXT NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
      listing_json TEXT NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_machines_provider ON machines(provider_id);

    CREATE TABLE IF NOT EXISTS placements (
      job_id      TEXT PRIMARY KEY,
      machine_id  TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      endpoint    TEXT NOT NULL,
      renter_uaid TEXT NOT NULL,
      placed_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_placements_machine ON placements(machine_id);
  `);

  // Added after the first deployments; existing databases predate it.
  const providerColumns = db.prepare(`PRAGMA table_info(providers)`).all() as Array<{
    name: string;
  }>;
  if (!providerColumns.some((c) => c.name === "active_jobs")) {
    db.exec(`ALTER TABLE providers ADD COLUMN active_jobs INTEGER NOT NULL DEFAULT 0`);
  }

  return db;
}

export type Db = Database.Database;
