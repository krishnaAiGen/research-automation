"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Field, Badge, Progress, Toast, Empty, StatTile, LoadError } from "@/components/ui";
import { getJSON, errorMessage } from "@/lib/api";
import type { CollectionSummary, PromptConfig } from "@/lib/types";
import type { CampaignSummary } from "@/lib/stats";

type Data = {
  campaigns: CampaignSummary[];
  running: number[];
  pending: number;
  pendingAllAddresses: number;
  collections: CollectionSummary[];
  tracks: string[];
};

const PRESETS = [10, 25, 50, 100, 250, 500];

export default function CampaignsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [configs, setConfigs] = useState<PromptConfig[]>([]);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "error" }>({ msg: "", tone: "ok" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    target_count: 25,
    sendAll: false,
    collection_id: 0,
    track_filter: "",
    prompt_config_id: 0,
    send_delay_ms: 3000,
    send_to_all: false,
    dry_run: true,
    test_recipient: "",
  });

  const load = async () => {
    let d: Data;
    let p: { configs: PromptConfig[] };
    try {
      [d, p] = await Promise.all([
        getJSON<Data>("/api/campaigns"),
        getJSON<{ configs: PromptConfig[] }>("/api/prompts"),
      ]);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    setData(d);
    setConfigs(p.configs);
    setForm((f) => ({
      ...f,
      prompt_config_id:
        f.prompt_config_id || (p.configs.find((c: PromptConfig) => c.is_active)?.id ?? 0),
      collection_id: f.collection_id || (d.collections[0]?.id ?? 0),
    }));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  if (error && !data) return <LoadError message={error} onRetry={() => load()} />;
  if (!data) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;

  const collection =
    data.collections.find((c) => c.id === form.collection_id) ?? data.collections[0];
  const paperBacked = (collection?.paper_backed ?? 0) > 0;
  const pool = collection ? (form.send_to_all ? collection.pending_all : collection.pending) : 0;
  const willSend = form.sendAll ? pool : Math.min(form.target_count, pool);

  const create = async (start: boolean) => {
    setBusy(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name || undefined,
        target_count: form.sendAll ? 0 : form.target_count,
        collection_id: form.collection_id || undefined,
        track_filter: form.track_filter,
        prompt_config_id: form.prompt_config_id || undefined,
        send_delay_ms: form.send_delay_ms,
        send_to_all: form.send_to_all,
        dry_run: form.dry_run,
        test_recipient: form.test_recipient,
        start,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setToast({ msg: json.error ?? "Failed", tone: "error" });
    if (start && json.started && !json.started.ok) {
      setToast({ msg: json.started.error ?? "Could not start", tone: "error" });
    } else {
      setToast({
        msg: start
          ? `Batch started — ${willSend.toLocaleString()} email${willSend === 1 ? "" : "s"}${form.dry_run ? " (dry run)" : ""}.`
          : "Batch saved as a draft.",
        tone: "ok",
      });
    }
    await load();
  };

  const control = async (id: number, action: string) => {
    const res = await fetch(`/api/campaigns/${id}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setToast({ msg: json.error ?? "Action failed", tone: "error" });
    await load();
  };

  const remove = async (id: number) => {
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setToast({ msg: json.error ?? "Delete failed", tone: "error" });
    await load();
  };

  const estMinutes = (willSend * (form.send_delay_ms + 2500)) / 60000;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Send a batch</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Choose how many of the remaining addresses to email. Anyone already emailed — including
          the {" "}
          <Link href="/recipients" className="underline">
            imported history
          </Link>{" "}
          — is never contacted twice.
        </p>
      </div>

      <Toast message={toast.msg} tone={toast.tone} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Available to email now"
          value={pool.toLocaleString()}
          hint={`${collection?.name ?? "—"} · ${form.send_to_all ? "every address" : "primary address per paper"}`}
          tone="accent"
        />
        <StatTile label="This batch will send" value={willSend.toLocaleString()} hint={form.dry_run ? "Dry run — nothing delivered" : "Live delivery"} />
        <StatTile
          label="Estimated duration"
          value={estMinutes < 60 ? `${Math.ceil(estMinutes)} min` : `${(estMinutes / 60).toFixed(1)} h`}
          hint={`${(form.send_delay_ms / 1000).toFixed(1)}s between sends + model latency`}
        />
      </div>

      <Card title="Batch settings">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Batch name" hint="Optional — a timestamped name is used otherwise">
              <input
                className="field"
                placeholder="e.g. ICML spotlight wave 1"
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
                onChange={(e) =>
                  setForm({ ...form, collection_id: Number(e.target.value), track_filter: "" })
                }
              >
                {data.collections.map((c) => (
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

          <div>
            <div className="mb-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              How many emails to send
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  className="btn"
                  style={
                    !form.sendAll && form.target_count === n
                      ? { background: "var(--series-1)", borderColor: "var(--series-1)", color: "#fff" }
                      : undefined
                  }
                  onClick={() => setForm({ ...form, target_count: n, sendAll: false })}
                  disabled={n > pool}
                >
                  {n}
                </button>
              ))}
              <button
                className="btn"
                style={
                  form.sendAll
                    ? { background: "var(--series-1)", borderColor: "var(--series-1)", color: "#fff" }
                    : undefined
                }
                onClick={() => setForm({ ...form, sendAll: true })}
              >
                All {pool.toLocaleString()}
              </button>
              <input
                type="number"
                min={1}
                max={pool}
                className="field tabular w-28"
                value={form.target_count}
                onChange={(e) =>
                  setForm({ ...form, target_count: Number(e.target.value), sendAll: false })
                }
              />
            </div>
            <div className="mt-3">
              <Progress
                value={willSend}
                total={Math.max(1, pool)}
                label={`${willSend.toLocaleString()} of ${pool.toLocaleString()} remaining addresses`}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* Tracks come from papers, so a hand-built list has nothing to filter. */}
            {paperBacked && (
              <Field label="Track filter" hint="Limit to one venue track">
                <select
                  className="field"
                  value={form.track_filter}
                  onChange={(e) => setForm({ ...form, track_filter: e.target.value })}
                >
                  <option value="">All tracks</option>
                  {data.tracks.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Delay between sends (ms)" hint="3000+ keeps Gmail happy">
              <input
                type="number"
                min={0}
                step={500}
                className="field tabular"
                value={form.send_delay_ms}
                onChange={(e) => setForm({ ...form, send_delay_ms: Number(e.target.value) })}
              />
            </Field>
            <Field label="Redirect to (testing)" hint="Every email goes here instead">
              <input
                className="field"
                placeholder="you@example.com"
                value={form.test_recipient}
                onChange={(e) => setForm({ ...form, test_recipient: e.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-2">
            {paperBacked && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.send_to_all}
                  onChange={(e) => setForm({ ...form, send_to_all: e.target.checked })}
                />
                Email every address on a paper, not just the first
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.dry_run}
                onChange={(e) => setForm({ ...form, dry_run: e.target.checked })}
              />
              Dry run — generate and log the emails but deliver nothing
            </label>
          </div>

          {!form.dry_run && (
            <div
              className="rounded-lg p-3 text-sm"
              style={{ background: "rgba(208,59,59,0.10)", color: "var(--critical)" }}
            >
              ! Live mode. {willSend.toLocaleString()} real email
              {willSend === 1 ? "" : "s"} will be delivered
              {form.test_recipient ? ` to ${form.test_recipient}` : " to paper authors"}.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              onClick={() => create(true)}
              disabled={busy || willSend === 0}
            >
              {busy ? "Starting…" : `Start sending ${willSend.toLocaleString()}`}
            </button>
            <button className="btn" onClick={() => create(false)} disabled={busy || willSend === 0}>
              Save as draft
            </button>
          </div>
        </div>
      </Card>

      <Card title="Batches">
        {data.campaigns.length === 0 ? (
          <Empty>No batches yet.</Empty>
        ) : (
          <div className="space-y-4">
            {data.campaigns.map((c) => {
              const done = c.sent + c.failed;
              return (
                <div key={c.id} className="rounded-lg p-3" style={{ background: "var(--plane)" }}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/campaigns/${c.id}`} className="flex items-center gap-2 text-sm font-medium hover:underline">
                      {c.name}
                      <Badge status={c.status} />
                      {c.dry_run === 1 && <Badge status="dry" />}
                    </Link>
                    <div className="flex items-center gap-2">
                      {(c.status === "draft" || c.status === "paused") && (
                        <button className="btn" onClick={() => control(c.id, "resume")}>
                          {c.status === "draft" ? "Start" : "Resume"}
                        </button>
                      )}
                      {c.status === "running" && (
                        <button className="btn" onClick={() => control(c.id, "pause")}>
                          Pause
                        </button>
                      )}
                      {["running", "paused", "draft", "queued"].includes(c.status) && (
                        <button className="btn btn-danger" onClick={() => control(c.id, "cancel")}>
                          Cancel
                        </button>
                      )}
                      {c.status !== "running" && (
                        <button className="btn btn-danger" onClick={() => remove(c.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <Progress
                    value={done}
                    total={Math.max(1, c.target_count)}
                    label={`${c.sent.toLocaleString()} ${c.dry_run === 1 ? "generated (not sent)" : "sent"}${c.failed > 0 ? `, ${c.failed} failed` : ""}${c.skipped > 0 ? `, ${c.skipped} skipped` : ""}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
