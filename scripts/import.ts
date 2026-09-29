/**
 * Import scraped papers into the app database.
 *
 *   npm run import                        # papers + recipients only
 *   npm run import -- --with-history      # also replay the Python sent_log.jsonl
 *   npm run import -- --papers <path> --sent-log <path>
 *
 * Safe to re-run: papers upsert, recipients dedupe on address, and imported
 * sends are matched on (email, source='import') so history is never doubled.
 *
 * The sent-log is opt-in because importing it marks those addresses as already
 * contacted — the opposite of what you want after `npm run reset`.
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { db, defaultCollectionId } from "../src/lib/db";

const SOURCE_ROOT =
  process.env.SCRAPER_ROOT || "/Users/krishnayadav/Documents/test_projects/openreview-scrapper";

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const papersPath = arg("papers", path.join(SOURCE_ROOT, "downloads", "papers.json"));
const sentLogPath = arg("sent-log", path.join(SOURCE_ROOT, "email_generator", "sent_log.jsonl"));

type RawPaper = {
  seq?: number;
  track?: string;
  number?: number;
  id?: string;
  title?: string;
  abstract?: string;
  emails?: string[];
  authors?: string[];
  forum?: string;
  pdf_path?: string;
};

function importPapers() {
  if (!fs.existsSync(papersPath)) {
    console.error(`! papers JSON not found: ${papersPath} — skipping paper import.`);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(papersPath, "utf8")) as RawPaper[];
  if (!Array.isArray(raw)) throw new Error("papers.json must be an array");

  const upsertPaper = db.prepare(`
    INSERT INTO papers (id, seq, track, number, title, abstract, authors, emails, forum, pdf_path)
    VALUES (@id, @seq, @track, @number, @title, @abstract, @authors, @emails, @forum, @pdf_path)
    ON CONFLICT(id) DO UPDATE SET
      seq = excluded.seq, track = excluded.track, number = excluded.number,
      title = excluded.title, abstract = excluded.abstract, authors = excluded.authors,
      emails = excluded.emails, forum = excluded.forum, pdf_path = excluded.pdf_path
  `);
  // Scraped addresses always land in the default collection; hand-built lists
  // are created in the app and are never touched by an import.
  const collectionId = defaultCollectionId();
  const insertRecipient = db.prepare(`
    INSERT OR IGNORE INTO recipients (collection_id, paper_id, email, position, seq, source)
    VALUES (?, ?, ?, ?, ?, 'import')
  `);

  let papers = 0;
  let recipients = 0;

  const run = db.transaction(() => {
    for (const p of raw) {
      const id = String(p.id ?? "").trim();
      if (!id) continue;
      const seq = Number(p.seq ?? 0);
      upsertPaper.run({
        id,
        seq,
        track: String(p.track ?? ""),
        number: Number(p.number ?? 0),
        title: String(p.title ?? "").trim(),
        abstract: String(p.abstract ?? "").trim(),
        authors: JSON.stringify(p.authors ?? []),
        emails: JSON.stringify(p.emails ?? []),
        forum: p.forum ?? null,
        pdf_path: p.pdf_path ?? null,
      });
      papers++;

      const seenOnPaper = new Set<string>();
      let position = 0;
      for (const rawEmail of p.emails ?? []) {
        const email = String(rawEmail ?? "").trim();
        if (!email || !email.includes("@")) continue;
        const key = email.toLowerCase();
        if (seenOnPaper.has(key)) continue;
        seenOnPaper.add(key);
        const info = insertRecipient.run(collectionId, id, email, position, seq);
        if (info.changes > 0) recipients++;
        position++;
      }
    }
  });
  run();

  console.log(`✓ papers: ${papers} upserted`);
  console.log(`✓ recipients: ${recipients} new unique addresses`);
}

type RawSend = {
  to?: string[];
  title?: string;
  id?: string;
  subject?: string;
  topic?: string;
  queries?: string[];
  body?: string;
};

/**
 * The Python sent-log carries no timestamps. Records are appended in send
 * order, so we spread them backwards from the log file's mtime at a fixed
 * cadence — enough to give the analytics a truthful ordering and a plausible
 * shape without inventing precision the log never had.
 */
function importSentLog() {
  if (!fs.existsSync(sentLogPath)) {
    console.error(`! sent-log not found: ${sentLogPath} — skipping history import.`);
    return;
  }
  const lines = fs
    .readFileSync(sentLogPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const endedAt = fs.statSync(sentLogPath).mtime.getTime();
  const SPACING_MS = 30_000;
  const startAt = endedAt - lines.length * SPACING_MS;

  const exists = db.prepare(
    "SELECT 1 FROM sends WHERE lower(email) = lower(?) AND source = 'import' LIMIT 1",
  );
  const insert = db.prepare(`
    INSERT INTO sends (campaign_id, paper_id, email, subject, topic, queries, body,
                       status, error, source, created_at)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'sent', NULL, 'import', ?)
  `);

  let imported = 0;
  let skipped = 0;

  const run = db.transaction(() => {
    lines.forEach((line, i) => {
      let rec: RawSend;
      try {
        rec = JSON.parse(line) as RawSend;
      } catch {
        return;
      }
      const at = new Date(startAt + i * SPACING_MS).toISOString();
      for (const rawEmail of rec.to ?? []) {
        const email = String(rawEmail ?? "").trim();
        if (!email) continue;
        if (exists.get(email)) {
          skipped++;
          continue;
        }
        insert.run(
          rec.id ?? null,
          email,
          rec.subject ?? "",
          rec.topic ?? "",
          JSON.stringify(rec.queries ?? []),
          rec.body ?? "",
          at,
        );
        imported++;
      }
    });
  });
  run();

  console.log(`✓ history: ${imported} sends imported, ${skipped} already present`);
}

const withHistory = process.argv.includes("--with-history");

console.log(`papers   : ${papersPath}`);
console.log(`sent-log : ${withHistory ? sentLogPath : "(skipped — pass --with-history to replay it)"}\n`);
importPapers();
if (withHistory) importSentLog();

const stats = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM papers) AS papers,
       (SELECT COUNT(*) FROM recipients) AS recipients,
       (SELECT COUNT(*) FROM sends WHERE status = 'sent') AS sent`,
  )
  .get() as { papers: number; recipients: number; sent: number };

console.log(
  `\nDatabase now holds ${stats.papers} papers, ${stats.recipients} addresses, ` +
    `${stats.sent} sent (${stats.recipients - stats.sent} remaining).`,
);
