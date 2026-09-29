import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODEL } from "./models";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, "app.db");

// --------------------------------------------------------------------------
// Default prompt config — conference announcement emails. The conference and
// sender details are fixed per configuration (edited on the Email prompt
// page); the recipient comes from each row of the target collection.
// Declared before `db` because the first-run seed reads them during migrate().
// --------------------------------------------------------------------------
export const DEFAULT_SYSTEM_PROMPT = `You draft concise, professional emails to researchers informing them about relevant academic conferences. Given conference details and recipient information, write a short personalized email that explains why the conference may interest them and includes key dates, location, submission deadline, and website. Do not invent details; use only the supplied fields. Keep the tone respectful, non-spammy, and under 150 words. If the recipient's first name can be inferred from their name or email, use it; otherwise use "Researcher". Return only the email subject and body.`;

export const DEFAULT_USER_PROMPT = `Conference details:
- Name: {{conference_name}}
- Website: {{conference_website}}
- Dates: {{conference_dates}}
- Location: {{conference_location}}
- Submission deadline: {{submission_deadline}}
- Notification date: {{notification_date}}
- Camera-ready deadline: {{camera_ready_deadline}}
- Topics/tracks: {{conference_topics}}
- Keynote speakers: {{keynote_speakers}}
- Organizers: {{organizers}}

Recipient:
- Name: {{recipient_name}}
- Email: {{recipient_email}}
- Research area: {{recipient_research_area}}

Sender:
- Name: {{sender_name}}
- Affiliation: {{sender_affiliation}}
- Role: {{sender_role}}

Write a short conference announcement email. Personalize the opening to the recipient's research area. Include the conference name, dates, location, submission deadline, and website. Add one clear call to action: submit a paper or register. Avoid exaggerated claims. Max 150 words. If a field is missing, omit it rather than inventing it. Return subject and body only.`;

export const DEFAULT_TEMPLATE = `Subject: Invitation: {{conference_name}} — {{conference_dates}} in {{conference_location}}

Hi {{first_name}},

I’m reaching out because your work in {{recipient_research_area}} seems relevant to {{conference_name}}. We’d love for you to consider submitting or attending.

{{conference_name}} will be held {{conference_dates}} in {{conference_location}}. The submission deadline is {{submission_deadline}}, and topics include {{conference_topics}}.

You can find details and submit here: {{conference_website}}.

Would this be of interest? If not, feel free to ignore this note.

Best,
{{sender_name}}
{{sender_affiliation}}
{{conference_name}}`;

/** Placeholders, not guesses — set the real URLs on the Email prompt page. */
export const DEFAULT_PRODUCT_URL = "[SET PRODUCT URL]";
export const DEFAULT_DEMO_URL = "[SET DEMO URL]";

/** The per-configuration conference and sender fields, in insert order. */
export const CONFERENCE_FIELDS = [
  "conference_name",
  "conference_website",
  "conference_dates",
  "conference_location",
  "submission_deadline",
  "notification_date",
  "camera_ready_deadline",
  "conference_topics",
  "keynote_speakers",
  "organizers",
  "sender_name",
  "sender_affiliation",
  "sender_role",
] as const;

// Next dev reloads modules on every edit; without a global handle each reload
// opens another connection to the same file and they fight over the write lock.
const globalForDb = globalThis as unknown as { __raDb?: Database.Database };

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export const db: Database.Database = globalForDb.__raDb ?? (globalForDb.__raDb = open());

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
      id        TEXT PRIMARY KEY,
      seq       INTEGER,
      track     TEXT,
      number    INTEGER,
      title     TEXT NOT NULL DEFAULT '',
      abstract  TEXT NOT NULL DEFAULT '',
      authors   TEXT NOT NULL DEFAULT '[]',
      emails    TEXT NOT NULL DEFAULT '[]',
      forum     TEXT,
      pdf_path  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_papers_track ON papers(track);

    -- A named list of addresses. The scraped author pool is one; hand-built
    -- lists are the others. Batches and schedules each target exactly one.
    CREATE TABLE IF NOT EXISTS collections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    -- One row per address per collection. Scraped rows carry a paper_id and
    -- get their email body generated from that paper; hand-added rows have
    -- paper_id NULL and rely on their name / notes instead.
    CREATE TABLE IF NOT EXISTS recipients (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      paper_id       TEXT REFERENCES papers(id) ON DELETE CASCADE,
      email          TEXT NOT NULL,
      name           TEXT NOT NULL DEFAULT '',
      notes          TEXT NOT NULL DEFAULT '',
      position       INTEGER NOT NULL DEFAULT 0,
      seq            INTEGER NOT NULL DEFAULT 0,
      source         TEXT NOT NULL DEFAULT 'import',
      created_at     TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS prompt_configs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      is_active      INTEGER NOT NULL DEFAULT 0,
      model          TEXT NOT NULL DEFAULT '${DEFAULT_MODEL}',
      reasoning      INTEGER NOT NULL DEFAULT 0,
      system_prompt  TEXT NOT NULL DEFAULT '',
      user_prompt    TEXT NOT NULL DEFAULT '',
      template       TEXT NOT NULL DEFAULT '',
      product_url    TEXT NOT NULL DEFAULT '',
      demo_url       TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      prompt_config_id  INTEGER REFERENCES prompt_configs(id),
      schedule_id       INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
      target_count      INTEGER NOT NULL DEFAULT 0,
      send_delay_ms     INTEGER NOT NULL DEFAULT 3000,
      send_to_all       INTEGER NOT NULL DEFAULT 0,
      dry_run           INTEGER NOT NULL DEFAULT 1,
      test_recipient    TEXT NOT NULL DEFAULT '',
      track_filter      TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'draft',
      sent              INTEGER NOT NULL DEFAULT 0,
      failed            INTEGER NOT NULL DEFAULT 0,
      skipped           INTEGER NOT NULL DEFAULT 0,
      error             TEXT,
      created_at        TEXT NOT NULL,
      started_at        TEXT,
      finished_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

    CREATE TABLE IF NOT EXISTS sends (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
      paper_id     TEXT,
      email        TEXT NOT NULL,
      subject      TEXT NOT NULL DEFAULT '',
      topic        TEXT NOT NULL DEFAULT '',
      queries      TEXT NOT NULL DEFAULT '[]',
      body         TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'sent',
      error        TEXT,
      source       TEXT NOT NULL DEFAULT 'app',
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sends_email ON sends(email);
    -- Every "has this person been emailed?" check compares lower(email), and
    -- SQLite cannot use the plain index above for that. Without this one the
    -- correlated EXISTS in stats/pendingCount degrades to a full scan of sends
    -- per recipient (~2.7s per dashboard poll at 7.5k addresses).
    CREATE INDEX IF NOT EXISTS idx_sends_email_lc ON sends(lower(email));
    CREATE INDEX IF NOT EXISTS idx_sends_status ON sends(status);
    CREATE INDEX IF NOT EXISTS idx_sends_created ON sends(created_at);
    CREATE INDEX IF NOT EXISTS idx_sends_campaign ON sends(campaign_id);

    CREATE TABLE IF NOT EXISTS schedules (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      prompt_config_id  INTEGER REFERENCES prompt_configs(id),
      batch_size        INTEGER NOT NULL DEFAULT 50,
      total_cap         INTEGER NOT NULL DEFAULT 0,
      sent_total        INTEGER NOT NULL DEFAULT 0,
      interval_minutes  INTEGER NOT NULL DEFAULT 1440,
      days_of_week      TEXT NOT NULL DEFAULT '[]',
      window_start      TEXT NOT NULL DEFAULT '09:00',
      window_end        TEXT NOT NULL DEFAULT '18:00',
      send_delay_ms     INTEGER NOT NULL DEFAULT 3000,
      dry_run           INTEGER NOT NULL DEFAULT 1,
      enabled           INTEGER NOT NULL DEFAULT 0,
      next_run_at       TEXT,
      last_run_at       TEXT,
      created_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  seedCollections(db);
  adoptCollections(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_recipients_seq ON recipients(seq);
    CREATE INDEX IF NOT EXISTS idx_recipients_paper ON recipients(paper_id);
    CREATE INDEX IF NOT EXISTS idx_recipients_collection ON recipients(collection_id);
    -- Addresses differing only in case are the same person, so the uniqueness
    -- that matters is on lower(email) — but scoped to the collection: the same
    -- address may legitimately sit in two lists. "Never emailed twice" is
    -- enforced by the sends table, not by this index.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_coll_email_lc
      ON recipients(collection_id, lower(email));
  `);

  // Batches and schedules each target one collection. Added late, so existing
  // rows are backfilled to the scraped pool they were already sending to.
  addColumn(db, "campaigns", "collection_id", "INTEGER REFERENCES collections(id)");
  addColumn(db, "schedules", "collection_id", "INTEGER REFERENCES collections(id)");
  const fallback = defaultCollectionId(db);
  db.prepare("UPDATE campaigns SET collection_id = ? WHERE collection_id IS NULL").run(fallback);
  db.prepare("UPDATE schedules SET collection_id = ? WHERE collection_id IS NULL").run(fallback);

  // The query count is no longer configurable — see QUERIES_PER_EMAIL. Unlike
  // the model, nothing can select this any more, so dropping the column is not
  // overriding a choice; it just stops a stale value from looking meaningful.
  dropColumn(db, "prompt_configs", "query_count");

  // Conference-announcement configs carry the conference and sender details
  // as fixed fields on the configuration; recipients supply name/email/notes.
  for (const column of CONFERENCE_FIELDS) {
    addColumn(db, "prompt_configs", column, "TEXT NOT NULL DEFAULT ''");
  }

  // Deliberately no "move old defaults forward" step for the model: every
  // entry in MODEL_CHOICES is something the user can pick, so rewriting one on
  // startup would silently undo their choice. DEFAULT_MODEL is for new rows.
  seedPromptConfig(db);
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function addColumn(db: Database.Database, table: string, column: string, decl: string) {
  if (hasColumn(db, table, column)) return;
  // `next build` collects page data with several workers at once, each running
  // migrate() on its own connection; two workers can both pass the check above
  // before either has altered the table. A concurrent duplicate is the race
  // resolving itself, so only that specific error is swallowed.
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  } catch (err) {
    const text = String((err as Error)?.message ?? err);
    if (!/duplicate column name/i.test(text)) throw err;
  }
}

function dropColumn(db: Database.Database, table: string, column: string) {
  if (!hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

function seedCollections(db: Database.Database) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM collections").get() as { n: number };
  if (row.n > 0) return;
  db.prepare("INSERT INTO collections (name, is_default, created_at) VALUES (?, 1, ?)").run(
    "Scraped paper authors",
    new Date().toISOString(),
  );
}

/** The list a batch falls back to, and the one `npm run import` fills. */
export function defaultCollectionId(handle: Database.Database = db): number {
  const row = handle
    .prepare("SELECT id FROM collections ORDER BY is_default DESC, id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!row) throw new Error("No collection exists.");
  return row.id;
}

/**
 * Move a pre-collections `recipients` table onto the new shape. The old one
 * had `paper_id NOT NULL` and a globally unique address, neither of which
 * survives collections — and SQLite cannot relax either in place, so the
 * table is rebuilt and every existing row lands in the default collection.
 */
function adoptCollections(db: Database.Database) {
  if (hasColumn(db, "recipients", "collection_id")) return;

  const fallback = defaultCollectionId(db);
  // A rebuild re-inserts every row; leaving FK enforcement on would reject
  // rows whose paper was deleted rather than carrying them across.
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE recipients_new (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        paper_id       TEXT REFERENCES papers(id) ON DELETE CASCADE,
        email          TEXT NOT NULL,
        name           TEXT NOT NULL DEFAULT '',
        notes          TEXT NOT NULL DEFAULT '',
        position       INTEGER NOT NULL DEFAULT 0,
        seq            INTEGER NOT NULL DEFAULT 0,
        source         TEXT NOT NULL DEFAULT 'import',
        created_at     TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO recipients_new (id, collection_id, paper_id, email, position, seq, source)
        SELECT id, ${fallback}, paper_id, email, position, seq, 'import'
          FROM recipients
         WHERE id IN (SELECT MIN(id) FROM recipients GROUP BY lower(email));
      DROP TABLE recipients;
      ALTER TABLE recipients_new RENAME TO recipients;
      COMMIT;
    `);
  } catch (err) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw err;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function getSetting(key: string, fallback = ""): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function seedPromptConfig(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM prompt_configs").get() as { n: number };
  if (count.n > 0) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO prompt_configs
      (name, is_active, model, reasoning, system_prompt, user_prompt,
       template, product_url, demo_url, created_at, updated_at)
     VALUES (?, 1, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "Conference announcement (default)",
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_USER_PROMPT,
    DEFAULT_TEMPLATE,
    // Deliberately not a guessed domain: these render verbatim into the email,
    // so a placeholder that is obviously wrong beats one that looks plausible.
    DEFAULT_PRODUCT_URL,
    DEFAULT_DEMO_URL,
    now,
    now,
  );
}
