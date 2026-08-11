import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'infytrack.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  migrate();
}

/** Additive, idempotent column migrations for databases created before a schema change. */
function migrate() {
  const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!columns.includes('theme_prefs')) {
    db.exec("ALTER TABLE users ADD COLUMN theme_prefs TEXT NOT NULL DEFAULT '{}'");
  }
}

/** Run fn inside a transaction. */
export function tx(fn) {
  return db.transaction(fn)();
}

export const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** Parse a JSON column, falling back to a default when the value is unusable. */
export function jsonCol(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export { DB_FILE };
