"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Field, Badge, Toast, Empty, StatTile, LoadError } from "@/components/ui";
import { getJSON, errorMessage } from "@/lib/api";
import type { CollectionSummary, PromptConfig, Schedule } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CADENCES = [
  { label: "Every hour", minutes: 60 },
  { label: "Every 4 hours", minutes: 240 },
  { label: "Every 12 hours", minutes: 720 },
  { label: "Once a day", minutes: 1440 },
  { label: "Every 2 days", minutes: 2880 },
  { label: "Once a week", minutes: 10080 },
];

type Run = {
  id: number;
  name: string;
  status: string;
  target_count: number;
  sent: number;
  failed: number;
  created_at: string;
  schedule_name: string;
};

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [configs, setConfigs] = useState<PromptConfig[]>([]);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "error" }>({ msg: "", tone: "ok" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    batch_size: 50,
    total_cap: 0,
    interval_minutes: 1440,
    days_of_week: [1, 2, 3, 4, 5] as number[],
    window_start: "09:00",
    window_end: "17:00",
    send_delay_ms: 3000,
    enabled: true,
    prompt_config_id: 0,
    collection_id: 0,
  });

  const load = async () => {
    let s: {
      schedules: Schedule[];
      upcoming: Run[];
      collections: CollectionSummary[];
    };
    let p: { configs: PromptConfig[] };
    try {
      [s, p] = await Promise.all([
        getJSON<typeof s>("/api/schedules"),
        getJSON<{ configs: PromptConfig[] }>("/api/prompts"),
      ]);
      setError(null);
    } catch (err) {
      // This page renders an empty shell rather than gating on state, so
      // without this the failure would be completely silent.
      setError(errorMessage(err));
      return;
    }
    setSchedules(s.schedules);
    setRuns(s.upcoming);
    setCollections(s.collections);
    setConfigs(p.configs);
    setForm((f) => ({
      ...f,
      prompt_config_id:
        f.prompt_config_id || (p.configs.find((c: PromptConfig) => c.is_active)?.id ?? 0),
      collection_id: f.collection_id || (s.collections[0]?.id ?? 0),
    }));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    setBusy(true);
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setToast({ msg: json.error ?? "Failed", tone: "error" });
    setToast({ msg: "Schedule created.", tone: "ok" });
    setForm({ ...form, name: "" });
    await load();
  };

  const patch = async (id: number, body: Record<string, unknown>) => {
    await fetch(`/api/schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  };

  const remove = async (id: number) => {
    await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    await load();
  };

  const toggleDay = (d: number) =>
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(d)
        ? f.days_of_week.filter((x) => x !== d)
        : [...f.days_of_week, d].sort(),
    }));

  const collection =
    collections.find((c) => c.id === form.collection_id) ?? collections[0];
  const pending = collection?.pending ?? 0;
  const perDay =
    form.interval_minutes > 0 ? (1440 / form.interval_minutes) * form.batch_size : 0;
  const daysToFinish = perDay > 0 ? Math.ceil(pending / perDay) : 0;

  if (error && collections.length === 0) {
    return <LoadError message={error} onRetry={() => load()} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Schedule sending</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          A schedule fires a batch on its own cadence, inside the hours you allow. Each run creates
          a normal batch you can inspect on the{" "}
          <Link href="/campaigns" className="underline">
            Send page
          </Link>
          .
        </p>
      </div>

      <Toast message={toast.msg} tone={toast.tone} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Remaining addresses"
          value={pending.toLocaleString()}
          hint={collection?.name}
          tone="accent"
        />
        <StatTile
          label="This schedule's pace"
          value={`${Math.round(perDay).toLocaleString()}/day`}
          hint={`${form.batch_size} per run`}
        />
        <StatTile
          label="Time to clear the pool"
          value={daysToFinish > 0 ? `${daysToFinish} days` : "—"}
          hint="At the pace above, ignoring windows"
        />
      </div>

      <Card title="New schedule">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <input
                className="field"
                placeholder="e.g. Weekday drip"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              label="Recipient collection"
              hint={
                <>
                  Manage lists on the{" "}
                  <Link href="/recipients" className="underline">
                    Recipients page
                  </Link>
                </>
              }
            >
              <select
                className="field"
                value={form.collection_id}
                onChange={(e) => setForm({ ...form, collection_id: Number(e.target.value) })}
              >
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.pending.toLocaleString()} available)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prompt configuration" hint="Each collection can use its own">
              <select
                className="field"
                value={form.prompt_config_id}
                onChange={(e) => setForm({ ...form, prompt_config_id: Number(e.target.value) })}
              >
                {configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_active ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Emails per run">
              <input
                type="number"
                min={1}
                className="field tabular"
                value={form.batch_size}
                onChange={(e) => setForm({ ...form, batch_size: Number(e.target.value) })}
              />
            </Field>
            <Field label="How often">
              <select
                className="field"
                value={form.interval_minutes}
                onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })}
              >
                {CADENCES.map((c) => (
                  <option key={c.minutes} value={c.minutes}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stop after (total)" hint="0 = run until the pool is empty">
              <input
                type="number"
                min={0}
                className="field tabular"
                value={form.total_cap}
                onChange={(e) => setForm({ ...form, total_cap: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Days it may run
            </div>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => {
                const on = form.days_of_week.includes(i);
                return (
                  <button
                    key={d}
                    className="btn"
                    onClick={() => toggleDay(i)}
                    style={
                      on
                        ? { background: "var(--series-1)", borderColor: "var(--series-1)", color: "#fff" }
                        : undefined
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Send window opens">
              <input
                type="time"
                className="field"
                value={form.window_start}
                onChange={(e) => setForm({ ...form, window_start: e.target.value })}
              />
            </Field>
            <Field label="Send window closes" hint="Equal times means all day">
              <input
                type="time"
                className="field"
                value={form.window_end}
                onChange={(e) => setForm({ ...form, window_end: e.target.value })}
              />
            </Field>
            <Field label="Delay between sends (ms)">
              <input
                type="number"
                min={0}
                step={500}
                className="field tabular"
                value={form.send_delay_ms}
                onChange={(e) => setForm({ ...form, send_delay_ms: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enable immediately
            </label>
          </div>

          {form.enabled && (
            <div
              className="rounded-lg p-3 text-sm"
              style={{ background: "rgba(208,59,59,0.10)", color: "var(--critical)" }}
            >
              ! This schedule delivers up to {form.batch_size} real emails per run, unattended. There is no dry run.
            </div>
          )}

          <button className="btn btn-primary" onClick={create} disabled={busy || !form.name}>
            {busy ? "Creating…" : "Create schedule"}
          </button>
        </div>
      </Card>

      <Card title="Schedules">
        {schedules.length === 0 ? (
          <Empty>No schedules yet.</Empty>
        ) : (
          <div className="space-y-3">
            {schedules.map((s) => (
              <div key={s.id} className="rounded-lg p-3" style={{ background: "var(--plane)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {s.name}
                    <Badge status={s.enabled ? "running" : "paused"} />
                    {s.dry_run === 1 && <Badge status="dry" />}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn" onClick={() => patch(s.id, { enabled: !s.enabled })}>
                      {s.enabled ? "Pause" : "Enable"}
                    </button>
                    <button className="btn btn-danger" onClick={() => remove(s.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2" style={{ color: "var(--text-secondary)" }}>
                  <div>
                    {s.batch_size} emails ·{" "}
                    {CADENCES.find((c) => c.minutes === s.interval_minutes)?.label ??
                      `every ${s.interval_minutes} min`}
                  </div>
                  <div>
                    {s.window_start}–{s.window_end} · {describeDays(s.days_of_week)}
                  </div>
                  <div>
                    →{" "}
                    {collections.find((c) => c.id === s.collection_id)?.name ??
                      "unknown collection"}
                  </div>
                  <div className="tabular">
                    Sent {s.sent_total.toLocaleString()}
                    {s.total_cap > 0 ? ` of ${s.total_cap.toLocaleString()} cap` : " so far"}
                  </div>
                  <div className="tabular">
                    {s.enabled && s.next_run_at
                      ? `Next run ${new Date(s.next_run_at).toLocaleString(undefined, {
                          weekday: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : s.last_run_at
                        ? `Last run ${new Date(s.last_run_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`
                        : "Never run"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Scheduled runs" subtitle="Batches created by a schedule">
        {runs.length === 0 ? (
          <Empty>No scheduled runs yet.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  <th className="py-2 text-left font-medium">Run</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Sent</th>
                  <th className="py-2 text-right font-medium">Failed</th>
                  <th className="py-2 text-right font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--gridline)" }}>
                    <td className="max-w-[300px] truncate py-2">
                      <Link href={`/campaigns/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2">
                      <Badge status={r.status} />
                    </td>
                    <td className="tabular py-2 text-right">{r.sent}</td>
                    <td
                      className="tabular py-2 text-right"
                      style={{ color: r.failed > 0 ? "var(--critical)" : undefined }}
                    >
                      {r.failed}
                    </td>
                    <td
                      className="tabular whitespace-nowrap py-2 text-right text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {new Date(r.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function describeDays(json: string): string {
  let days: number[] = [];
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) days = v.map(Number);
  } catch {
    /* treat as every day */
  }
  if (days.length === 0 || days.length === 7) return "every day";
  return days.map((d) => DAYS[d]).join(", ");
}
