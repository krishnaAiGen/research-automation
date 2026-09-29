import { db, defaultCollectionId } from "./db";
import { startCampaign, isRunning, pendingCount } from "./runner";
import type { Schedule } from "./types";

const TICK_MS = 30_000;

const g = globalThis as unknown as { __raSchedulerTimer?: NodeJS.Timeout };

function minutesOfDay(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(s: string, fallback: number) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return fallback;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

function allowedDays(schedule: Schedule): number[] {
  try {
    const v = JSON.parse(schedule.days_of_week);
    if (Array.isArray(v) && v.length > 0) return v.map(Number);
  } catch {
    /* fall through to "every day" */
  }
  return [0, 1, 2, 3, 4, 5, 6];
}

/**
 * True when `at` falls inside the schedule's allowed weekday set and its
 * daily send window. A window whose end is at or before its start is treated
 * as crossing midnight (e.g. 22:00 → 04:00).
 */
export function inWindow(schedule: Schedule, at: Date): boolean {
  if (!allowedDays(schedule).includes(at.getDay())) return false;
  const start = parseHHMM(schedule.window_start, 0);
  const end = parseHHMM(schedule.window_end, 24 * 60);
  const now = minutesOfDay(at);
  if (start === end) return true; // 24h window
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * Earliest moment at or after `from` that the schedule is allowed to run:
 * `from` itself if it is already inside a window, otherwise the next window
 * opening on an allowed day.
 */
export function nextOpening(schedule: Schedule, from: Date = new Date()): Date {
  if (inWindow(schedule, from)) return new Date(from);

  const start = parseHHMM(schedule.window_start, 0);
  const candidate = new Date(from);
  // Today's window has already opened (and we're outside it), so the next one
  // is tomorrow's.
  if (minutesOfDay(from) >= start) candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(Math.floor(start / 60), start % 60, 0, 0);

  for (let i = 0; i < 14; i++) {
    if (inWindow(schedule, candidate)) return candidate;
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

/**
 * When the schedule should fire after a run at `from`: one interval later,
 * pushed forward to the next window if that lands outside one.
 */
export function computeNextRun(schedule: Schedule, from: Date = new Date()): Date {
  return nextOpening(schedule, new Date(from.getTime() + schedule.interval_minutes * 60_000));
}

export function listSchedules(): Schedule[] {
  return db.prepare("SELECT * FROM schedules ORDER BY id DESC").all() as Schedule[];
}

export function resetNextRun(scheduleId: number, from: Date = new Date()) {
  const s = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as
    | Schedule
    | undefined;
  if (!s) return;
  // Enabling is not a run, so the interval does not apply yet: fire at the next
  // opening (immediately, if we are already inside a window). Waiting a full
  // interval here would make a daily schedule enabled at 8pm skip a whole day.
  const next = nextOpening(s, from);
  db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(next.toISOString(), s.id);
}

function dueSchedules(now: Date): Schedule[] {
  return db
    .prepare(
      `SELECT * FROM schedules
        WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
        ORDER BY id`,
    )
    .all(now.toISOString()) as Schedule[];
}

function fire(schedule: Schedule, now: Date) {
  // Don't stack runs: if this schedule's last campaign is still going, skip
  // this tick and try again on the next one.
  const active = db
    .prepare(
      "SELECT id FROM campaigns WHERE schedule_id = ? AND status IN ('running','queued') LIMIT 1",
    )
    .get(schedule.id) as { id: number } | undefined;
  if (active && isRunning(active.id)) return;

  let batch = schedule.batch_size;
  if (schedule.total_cap > 0) {
    const left = schedule.total_cap - schedule.sent_total;
    if (left <= 0) {
      db.prepare("UPDATE schedules SET enabled = 0, next_run_at = NULL WHERE id = ?").run(
        schedule.id,
      );
      return;
    }
    batch = Math.min(batch, left);
  }

  const collectionId = schedule.collection_id ?? defaultCollectionId();

  if (pendingCount({ send_to_all: 0, collection_id: collectionId }) === 0) {
    db.prepare("UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?").run(
      now.toISOString(),
      computeNextRun(schedule, now).toISOString(),
      schedule.id,
    );
    return;
  }

  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const info = db
    .prepare(
      `INSERT INTO campaigns
        (name, prompt_config_id, schedule_id, collection_id, target_count, send_delay_ms,
         send_to_all, dry_run, test_recipient, track_filter, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, '', '', 'queued', ?)`,
    )
    .run(
      `${schedule.name} — ${stamp}`,
      schedule.prompt_config_id,
      schedule.id,
      collectionId,
      batch,
      schedule.send_delay_ms,
      schedule.dry_run,
      now.toISOString(),
    );

  db.prepare("UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?").run(
    now.toISOString(),
    computeNextRun(schedule, now).toISOString(),
    schedule.id,
  );

  startCampaign(Number(info.lastInsertRowid));
}

export function tick() {
  const now = new Date();
  for (const schedule of dueSchedules(now)) {
    try {
      if (!inWindow(schedule, now)) {
        db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(
          computeNextRun(schedule, now).toISOString(),
          schedule.id,
        );
        continue;
      }
      fire(schedule, now);
    } catch (err) {
      console.error(`[scheduler] schedule ${schedule.id} failed:`, err);
    }
  }
}

export function startScheduler() {
  if (g.__raSchedulerTimer) return;
  g.__raSchedulerTimer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    }
  }, TICK_MS);
  // Don't hold the process open on shutdown.
  g.__raSchedulerTimer.unref?.();
  console.log("[scheduler] started");
}
