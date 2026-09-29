import { db } from "./db";
import { generateEmail } from "./openrouter";
import { renderEmail } from "./render";
import { Mailer, smtpCredsFromEnv } from "./mailer";
import type { Campaign, PromptConfig, QueueItem } from "./types";

type RunState = {
  campaignId: number;
  abort: AbortController;
  paused: boolean;
  current: string | null;
};

// Survives dev-server module reloads, same reason as the db handle.
const g = globalThis as unknown as { __raRuns?: Map<number, RunState> };
const runs: Map<number, RunState> = g.__raRuns ?? (g.__raRuns = new Map());

export function isRunning(campaignId: number) {
  return runs.has(campaignId);
}

export function runningCampaignIds(): number[] {
  return [...runs.keys()];
}

export function pauseCampaign(campaignId: number) {
  const st = runs.get(campaignId);
  if (!st) return false;
  st.paused = true;
  st.abort.abort();
  return true;
}

export function cancelCampaign(campaignId: number) {
  const st = runs.get(campaignId);
  if (st) {
    st.paused = false;
    st.abort.abort();
    return true;
  }
  db.prepare(
    "UPDATE campaigns SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('draft','queued','paused')",
  ).run(new Date().toISOString(), campaignId);
  return true;
}

/**
 * The WHERE shared by the queue and its count, so the number shown on the
 * button is the number the batch finds. Eligible means: never successfully
 * emailed before (across every batch and the imported history), in the target
 * collection, optionally narrowed to one track, and — unless send_to_all —
 * only the primary address per paper.
 *
 * Hand-added contacts have no paper, so the per-paper rules (primary address,
 * track, "has an abstract to generate from") are skipped for them.
 */
function eligibility(filter: Partial<Campaign>): { sql: string; params: unknown[] } {
  const where: string[] = [
    `NOT EXISTS (SELECT 1 FROM sends s WHERE lower(s.email) = lower(r.email) AND s.status = 'sent')`,
  ];
  const params: unknown[] = [];

  if (filter.collection_id) {
    where.push("r.collection_id = ?");
    params.push(filter.collection_id);
  }
  if (!filter.send_to_all) where.push("(r.paper_id IS NULL OR r.position = 0)");
  if (filter.track_filter) {
    where.push("p.track = ?");
    params.push(filter.track_filter);
  }
  where.push("(r.paper_id IS NULL OR length(trim(p.abstract)) > 0)");

  return { sql: where.join(" AND "), params };
}

export function pendingQueue(campaign: Campaign, limit: number): QueueItem[] {
  const { sql, params } = eligibility(campaign);
  return db
    .prepare(
      `SELECT r.id AS recipient_id, r.email, r.name, r.notes,
              r.paper_id, p.title, p.abstract, p.authors, p.track
         FROM recipients r
         LEFT JOIN papers p ON p.id = r.paper_id
        WHERE ${sql}
        ORDER BY r.seq ASC, r.id ASC
        LIMIT ?`,
    )
    .all(...params, limit) as QueueItem[];
}

export function pendingCount(filter: Partial<Campaign> = {}): number {
  const { sql, params } = eligibility(filter);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM recipients r LEFT JOIN papers p ON p.id = r.paper_id
        WHERE ${sql}`,
    )
    .get(...params) as { n: number };
  return row.n;
}

function loadCampaign(id: number): Campaign | undefined {
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Campaign | undefined;
}

function loadConfig(id: number | null): PromptConfig {
  const cfg = (id
    ? db.prepare("SELECT * FROM prompt_configs WHERE id = ?").get(id)
    : db.prepare("SELECT * FROM prompt_configs WHERE is_active = 1 ORDER BY id LIMIT 1").get()) as
    | PromptConfig
    | undefined;
  if (!cfg) throw new Error("No prompt configuration found.");
  return cfg;
}

function recordSend(row: {
  campaignId: number;
  paperId: string | null;
  email: string;
  subject: string;
  body: string;
  status: "sent" | "failed" | "dry";
  error?: string | null;
}) {
  db.prepare(
    `INSERT INTO sends (campaign_id, paper_id, email, subject, topic, queries, body,
                        status, error, source, created_at)
     VALUES (?, ?, ?, ?, '', '[]', ?, ?, ?, 'app', ?)`,
  ).run(
    row.campaignId,
    row.paperId,
    row.email,
    row.subject,
    row.body,
    row.status,
    row.error ?? null,
    new Date().toISOString(),
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Start a campaign in the background. Returns immediately; progress lands in
 * the campaigns/sends tables where the UI polls it.
 */
export function startCampaign(campaignId: number): { ok: boolean; error?: string } {
  if (runs.has(campaignId)) return { ok: false, error: "Campaign is already running." };

  const campaign = loadCampaign(campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status === "completed" || campaign.status === "cancelled") {
    return { ok: false, error: `Campaign is ${campaign.status}.` };
  }

  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY is not set in .env.local." };

  if (!campaign.dry_run) {
    const creds = smtpCredsFromEnv();
    if (!creds.address || !creds.appPassword) {
      return {
        ok: false,
        error: "GMAIL_ADDRESS / GMAIL_APP_PASSWORD must be set for a live send.",
      };
    }
  }

  const state: RunState = {
    campaignId,
    abort: new AbortController(),
    paused: false,
    current: null,
  };
  runs.set(campaignId, state);

  db.prepare(
    `UPDATE campaigns SET status = 'running', error = NULL,
       started_at = COALESCE(started_at, ?) WHERE id = ?`,
  ).run(new Date().toISOString(), campaignId);

  void execute(state, apiKey).catch((err) => {
    db.prepare(
      "UPDATE campaigns SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
    ).run(String(err?.message ?? err), new Date().toISOString(), campaignId);
    runs.delete(campaignId);
  });

  return { ok: true };
}

async function execute(state: RunState, apiKey: string) {
  const campaignId = state.campaignId;
  let campaign = loadCampaign(campaignId)!;
  const cfg = loadConfig(campaign.prompt_config_id);
  const live = !campaign.dry_run;
  const mailer = live ? new Mailer(smtpCredsFromEnv()) : null;

  // How many more this campaign still owes. target_count 0 means "everything
  // still pending".
  const alreadyDone = campaign.sent + campaign.failed;
  const remaining =
    campaign.target_count > 0
      ? Math.max(0, campaign.target_count - alreadyDone)
      : pendingCount(campaign);

  try {
    // Over-fetch a little: some rows get dropped mid-run by a concurrent
    // campaign claiming the same address.
    const queue = pendingQueue(campaign, remaining + 25);
    let processed = 0;

    for (const item of queue) {
      if (processed >= remaining) break;
      if (state.abort.signal.aborted) break;

      state.current = item.email;

      // Re-check: another campaign may have taken this address since the
      // queue snapshot.
      const taken = db
        .prepare("SELECT 1 FROM sends WHERE lower(email) = lower(?) AND status = 'sent' LIMIT 1")
        .get(item.email);
      if (taken) {
        db.prepare("UPDATE campaigns SET skipped = skipped + 1 WHERE id = ?").run(campaignId);
        continue;
      }

      // The conference and sender sides come from the config; the recipient
      // side is this row. Hand-added contacts carry their research area in
      // `notes`; scraped authors leave it empty and the prompt says to omit.
      const recipients = campaign.test_recipient ? [campaign.test_recipient] : [item.email];

      let subject = "";
      let body = "";
      try {
        const gen = await generateEmail(apiKey, cfg, {
          recipient: item.email,
          name: item.name,
          notes: item.notes,
        });
        subject = gen.subject;
        body = gen.body;
      } catch (err) {
        if (state.abort.signal.aborted) break;
        recordSend({
          campaignId,
          paperId: item.paper_id,
          email: item.email,
          subject: "",
          body: "",
          status: "failed",
          error: `draft: ${String((err as Error)?.message ?? err)}`,
        });
        db.prepare("UPDATE campaigns SET failed = failed + 1 WHERE id = ?").run(campaignId);
        processed++;
        continue;
      }

      // A reply with no usable body falls back to the config's template so the
      // recipient still gets a complete, factually correct email.
      if (!body.trim()) {
        const fallback = renderEmail(cfg, {
          email: item.email,
          name: item.name,
          researchArea: item.notes,
        });
        subject = subject || fallback.subject;
        body = fallback.body;
      }

      if (!live) {
        recordSend({
          campaignId,
          paperId: item.paper_id,
          email: item.email,
          subject,
          body,
          status: "dry",
        });
        db.prepare("UPDATE campaigns SET sent = sent + 1 WHERE id = ?").run(campaignId);
      } else {
        try {
          await mailer!.send(recipients, subject, body);
          recordSend({
            campaignId,
            paperId: item.paper_id,
            email: item.email,
            subject,
            body,
            status: "sent",
          });
          db.prepare("UPDATE campaigns SET sent = sent + 1 WHERE id = ?").run(campaignId);
        } catch (err) {
          recordSend({
            campaignId,
            paperId: item.paper_id,
            email: item.email,
            subject,
            body,
            status: "failed",
            error: `send: ${String((err as Error)?.message ?? err)}`,
          });
          db.prepare("UPDATE campaigns SET failed = failed + 1 WHERE id = ?").run(campaignId);
        }
      }

      processed++;
      if (campaign.send_delay_ms > 0 && processed < remaining) {
        await sleep(campaign.send_delay_ms, state.abort.signal);
      }
    }

    campaign = loadCampaign(campaignId)!;
    const now = new Date().toISOString();

    // Falling out of the loop without an abort means either the target was met
    // or the pending pool ran dry — both are "completed".
    if (state.paused) {
      db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(campaignId);
    } else if (state.abort.signal.aborted) {
      db.prepare("UPDATE campaigns SET status = 'cancelled', finished_at = ? WHERE id = ?").run(
        now,
        campaignId,
      );
    } else {
      db.prepare("UPDATE campaigns SET status = 'completed', finished_at = ? WHERE id = ?").run(
        now,
        campaignId,
      );
    }

    if (campaign.schedule_id) {
      db.prepare("UPDATE schedules SET sent_total = sent_total + ? WHERE id = ?").run(
        campaign.sent,
        campaign.schedule_id,
      );
    }
  } finally {
    mailer?.close();
    runs.delete(campaignId);
  }
}

export function runStatus(campaignId: number) {
  const st = runs.get(campaignId);
  return st ? { running: true, current: st.current, paused: st.paused } : { running: false };
}
