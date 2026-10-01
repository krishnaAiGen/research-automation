import { db } from "./db";

export type Overview = {
  papers: number;
  addresses: number;
  /** Addresses in the pool that have been emailed — drives the coverage bar. */
  contacted: number;
  /** Total successful deliveries, including any to addresses outside the pool. */
  sent: number;
  failed: number;
  dryRun: number;
  remaining: number;
  pctSent: number;
  deliveryRate: number;
  sentLast7: number;
  sentLast30: number;
  activeCampaigns: number;
  enabledSchedules: number;
};

export function overview(): Overview {
  const base = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM papers)                                  AS papers,
         (SELECT COUNT(*) FROM recipients)                              AS addresses,
         (SELECT COUNT(*) FROM recipients r WHERE EXISTS (
            SELECT 1 FROM sends s
             WHERE lower(s.email) = lower(r.email) AND s.status = 'sent'))
                                                                        AS contacted,
         (SELECT COUNT(*) FROM sends WHERE status = 'sent')             AS sent,
         (SELECT COUNT(*) FROM sends WHERE status = 'failed')           AS failed,
         (SELECT COUNT(*) FROM sends WHERE status = 'dry')              AS dryRun,
         (SELECT COUNT(*) FROM campaigns WHERE status IN ('running','queued')) AS activeCampaigns,
         (SELECT COUNT(*) FROM schedules WHERE enabled = 1)             AS enabledSchedules`,
    )
    .get() as Omit<Overview, "remaining" | "pctSent" | "deliveryRate" | "sentLast7" | "sentLast30">;

  const since = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString();

  const recent = db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7,
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last30
       FROM sends WHERE status = 'sent'`,
    )
    .get(since(7), since(30)) as { last7: number | null; last30: number | null };

  const remaining = Math.max(0, base.addresses - base.contacted);
  const attempted = base.sent + base.failed;

  return {
    ...base,
    remaining,
    pctSent: base.addresses > 0 ? (base.contacted / base.addresses) * 100 : 0,
    deliveryRate: attempted > 0 ? (base.sent / attempted) * 100 : 0,
    sentLast7: recent.last7 ?? 0,
    sentLast30: recent.last30 ?? 0,
  };
}

export type DayPoint = { day: string; sent: number; failed: number };

/** Daily sent/failed counts for the last `days` days, zero-filled. */
export function sendsByDay(days = 30): DayPoint[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              SUM(CASE WHEN status IN ('sent','dry') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)        AS failed
         FROM sends
        WHERE created_at >= ?
        GROUP BY day ORDER BY day`,
    )
    .all(start.toISOString()) as DayPoint[];

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, sent: 0, failed: 0 });
  }
  return out;
}

export type TrackRow = { track: string; addresses: number; sent: number };

export function byTrack(): TrackRow[] {
  return db
    .prepare(
      `SELECT p.track AS track,
              COUNT(*) AS addresses,
              SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM sends s
                     WHERE lower(s.email) = lower(r.email) AND s.status = 'sent'
                  ) THEN 1 ELSE 0 END) AS sent
         FROM recipients r JOIN papers p ON p.id = r.paper_id
        GROUP BY p.track ORDER BY addresses DESC`,
    )
    .all() as TrackRow[];
}

export type DomainRow = { domain: string; n: number };

export function topDomains(limit = 8): DomainRow[] {
  return db
    .prepare(
      `SELECT lower(substr(email, instr(email, '@') + 1)) AS domain, COUNT(*) AS n
         FROM sends WHERE status = 'sent'
        GROUP BY domain ORDER BY n DESC LIMIT ?`,
    )
    .all(limit) as DomainRow[];
}

export type RecentSend = {
  id: number;
  email: string;
  subject: string;
  topic: string;
  status: string;
  error: string | null;
  created_at: string;
  campaign_name: string | null;
  title: string | null;
};

export function recentSends(limit = 20): RecentSend[] {
  return db
    .prepare(
      `SELECT s.id, s.email, s.subject, s.topic, s.status, s.error, s.created_at,
              c.name AS campaign_name, p.title AS title
         FROM sends s
         LEFT JOIN campaigns c ON c.id = s.campaign_id
         LEFT JOIN papers p ON p.id = s.paper_id
        ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
    )
    .all(limit) as RecentSend[];
}

export type CampaignSummary = {
  id: number;
  name: string;
  status: string;
  target_count: number;
  sent: number;
  failed: number;
  skipped: number;
  dry_run: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function campaignSummaries(limit = 50): CampaignSummary[] {
  return db
    .prepare(
      `SELECT id, name, status, target_count, sent, failed, skipped, dry_run,
              created_at, started_at, finished_at
         FROM campaigns ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as CampaignSummary[];
}

export function tracks(): string[] {
  return (
    db.prepare("SELECT DISTINCT track FROM papers WHERE track <> '' ORDER BY track").all() as {
      track: string;
    }[]
  ).map((r) => r.track);
}
