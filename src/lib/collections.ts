import { db, defaultCollectionId } from "./db";
import { pendingCount } from "./runner";
import { parseEmailList } from "./emails";
import type { Collection, CollectionSummary, Recipient } from "./types";

export function listCollections(): Collection[] {
  return db
    .prepare("SELECT * FROM collections ORDER BY is_default DESC, id")
    .all() as Collection[];
}

export function getCollection(id: number): Collection | undefined {
  return db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as Collection | undefined;
}

/**
 * Every collection with the counts the Send and Recipients screens need.
 * `pending` comes from the runner's own query rather than a second one here,
 * so the number on the button is the number the batch will actually find.
 */
export function collectionSummaries(): CollectionSummary[] {
  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM recipients r WHERE r.collection_id = c.id) AS total,
              (SELECT COUNT(*) FROM recipients r
                WHERE r.collection_id = c.id
                  AND EXISTS (SELECT 1 FROM sends s
                               WHERE lower(s.email) = lower(r.email)
                                 AND s.status = 'sent'))                      AS contacted,
              (SELECT COUNT(*) FROM recipients r
                WHERE r.collection_id = c.id AND r.paper_id IS NOT NULL)      AS paper_backed
         FROM collections c
        ORDER BY c.is_default DESC, c.id`,
    )
    .all() as Omit<CollectionSummary, "pending" | "pending_all">[];

  return rows.map((c) => ({
    ...c,
    pending: pendingCount({ send_to_all: 0, collection_id: c.id }),
    pending_all: pendingCount({ send_to_all: 1, collection_id: c.id }),
  }));
}

export function createCollection(name: string): Collection {
  const info = db
    .prepare("INSERT INTO collections (name, is_default, created_at) VALUES (?, 0, ?)")
    .run(name.trim() || "Untitled collection", new Date().toISOString());
  return getCollection(Number(info.lastInsertRowid))!;
}

export function renameCollection(id: number, name: string): Collection | undefined {
  db.prepare("UPDATE collections SET name = ? WHERE id = ?").run(
    name.trim() || "Untitled collection",
    id,
  );
  return getCollection(id);
}

export type AddResult = {
  added: number;
  duplicates: string[];
  invalid: string[];
};

/**
 * Add hand-entered addresses to a collection. `name` and `notes` are what a
 * prompt has to work with instead of a paper, so they only make sense when a
 * single address is being added — a bulk paste shares one set of notes and no
 * name at all.
 */
export function addRecipients(
  collectionId: number,
  raw: string,
  opts: { name?: string; notes?: string } = {},
): AddResult {
  const { emails, invalid } = parseEmailList(raw);
  const single = emails.length === 1;
  const name = single ? (opts.name ?? "").trim() : "";
  const notes = (opts.notes ?? "").trim();
  const now = new Date().toISOString();

  // Keeps hand-added rows after the scraped ones in the send order, which is
  // `seq` then `id`.
  const seq = (
    db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM recipients").get() as { n: number }
  ).n;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO recipients
       (collection_id, paper_id, email, name, notes, position, seq, source, created_at)
     VALUES (?, NULL, ?, ?, ?, 0, ?, 'manual', ?)`,
  );

  const duplicates: string[] = [];
  let added = 0;

  db.transaction(() => {
    for (const email of emails) {
      const info = insert.run(collectionId, email, name, notes, seq + 1, now);
      if (info.changes > 0) added++;
      else duplicates.push(email);
    }
  })();

  return { added, duplicates, invalid };
}

export function deleteRecipients(collectionId: number, ids: number[]): number {
  if (ids.length === 0) return 0;
  const del = db.prepare("DELETE FROM recipients WHERE id = ? AND collection_id = ?");
  let removed = 0;
  db.transaction(() => {
    for (const id of ids) removed += del.run(id, collectionId).changes;
  })();
  return removed;
}

export function updateRecipient(
  id: number,
  patch: { name?: string; notes?: string },
): Recipient | undefined {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(String(patch.name).trim());
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(String(patch.notes).trim());
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE recipients SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  }
  return db.prepare("SELECT * FROM recipients WHERE id = ?").get(id) as Recipient | undefined;
}

/**
 * Deleting a collection drops its addresses but never its sends — those are
 * the record of who was contacted, and losing them would let the same people
 * be emailed again from a rebuilt list.
 */
export function deleteCollection(id: number): { ok: boolean; error?: string } {
  const collection = getCollection(id);
  if (!collection) return { ok: false, error: "Collection not found." };
  if (id === defaultCollectionId()) {
    return {
      ok: false,
      error:
        "The scraped pool cannot be deleted — rebuilding it means re-running the scraper. Rename it instead.",
    };
  }

  const running = db
    .prepare(
      `SELECT 1 FROM campaigns
        WHERE collection_id = ? AND status IN ('running','queued') LIMIT 1`,
    )
    .get(id);
  if (running) return { ok: false, error: "A batch is still running against this collection." };

  db.transaction(() => {
    db.prepare("DELETE FROM recipients WHERE collection_id = ?").run(id);
    db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  })();
  return { ok: true };
}
