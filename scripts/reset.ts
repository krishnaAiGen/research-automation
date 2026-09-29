/**
 * Clear sending history so the whole address pool becomes available again.
 *
 *   npm run reset              # wipe sends, batches, and schedules
 *   npm run reset -- --prompts # also restore the prompt config to the default
 *
 * Papers and recipients are never touched — re-scraping them is expensive and
 * they carry no send state. The database file is copied to a timestamped
 * backup first, because deleting the send log is exactly what stops someone
 * being emailed twice and an accidental run should be recoverable.
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODEL } from "../src/lib/models";
import {
  db,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT,
  DEFAULT_TEMPLATE,
  DEFAULT_PRODUCT_URL,
  DEFAULT_DEMO_URL,
} from "../src/lib/db";

const resetPrompts = process.argv.includes("--prompts");
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "app.db");

function backup() {
  if (!fs.existsSync(dbPath)) return null;
  // WAL mode keeps recent writes outside the main file; checkpoint so the copy
  // is complete rather than missing the newest rows.
  db.pragma("wal_checkpoint(TRUNCATE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(path.dirname(dbPath), `app.backup-${stamp}.db`);
  fs.copyFileSync(dbPath, dest);
  return dest;
}

const before = db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM sends) AS sends,
            (SELECT COUNT(*) FROM campaigns) AS campaigns,
            (SELECT COUNT(*) FROM schedules) AS schedules,
            (SELECT COUNT(*) FROM recipients) AS recipients`,
  )
  .get() as { sends: number; campaigns: number; schedules: number; recipients: number };

const backupPath = backup();
if (backupPath) console.log(`backup   : ${backupPath}`);

db.transaction(() => {
  db.prepare("DELETE FROM sends").run();
  db.prepare("DELETE FROM campaigns").run();
  db.prepare("DELETE FROM schedules").run();

  if (resetPrompts) {
    const now = new Date().toISOString();
    db.prepare("DELETE FROM prompt_configs").run();
    db.prepare(
      `INSERT INTO prompt_configs
        (name, is_active, model, reasoning, system_prompt, user_prompt,
         template, product_url, demo_url, created_at, updated_at)
       VALUES (?, 1, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "CCRI Taiwan outreach (default)",
      DEFAULT_MODEL,
      DEFAULT_SYSTEM_PROMPT,
      DEFAULT_USER_PROMPT,
      DEFAULT_TEMPLATE,
      DEFAULT_PRODUCT_URL,
      DEFAULT_DEMO_URL,
      now,
      now,
    );
  }
})();

console.log(
  `\ncleared  : ${before.sends} sends, ${before.campaigns} batches, ${before.schedules} schedules` +
    (resetPrompts ? "\nprompts  : restored to the built-in default" : ""),
);
console.log(
  `\nAll ${before.recipients.toLocaleString()} addresses are now unsent and available to email.`,
);
