"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge, Progress, StatTile, Empty, LoadError } from "@/components/ui";
import { getJSON, errorMessage } from "@/lib/api";
import type { Campaign } from "@/lib/types";

type SendRow = {
  id: number;
  email: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
  body: string;
  title: string | null;
};

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [run, setRun] = useState<{ running: boolean; current?: string | null }>({ running: false });
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const json = await getJSON<{
        campaign: Campaign;
        sends: SendRow[];
        run: { running: boolean; current?: string | null };
      }>(`/api/campaigns/${id}`);
      setCampaign(json.campaign);
      setSends(json.sends);
      setRun(json.run);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const control = async (action: string) => {
    await fetch(`/api/campaigns/${id}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
  };

  if (error && !campaign) return <LoadError message={error} onRetry={() => load()} />;
  if (!campaign) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;

  const done = campaign.sent + campaign.failed;

  return (
    <div className="space-y-5">
      <Link href="/campaigns" className="text-sm underline" style={{ color: "var(--text-secondary)" }}>
        ← All batches
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          {campaign.name}
          <Badge status={campaign.status} />
          {campaign.dry_run === 1 && <Badge status="dry" />}
        </h1>
        <div className="flex gap-2">
          {(campaign.status === "draft" || campaign.status === "paused") && (
            <button className="btn btn-primary" onClick={() => control("resume")}>
              {campaign.status === "draft" ? "Start" : "Resume"}
            </button>
          )}
          {campaign.status === "running" && (
            <button className="btn" onClick={() => control("pause")}>
              Pause
            </button>
          )}
          {["running", "paused", "draft", "queued"].includes(campaign.status) && (
            <button className="btn btn-danger" onClick={() => control("cancel")}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* A cooldown is a wait, not a failure — amber, and separate from the
          red error banner, or it reads as "this batch is broken". */}
      {campaign.cooldown_until && campaign.status === "paused" ? (
        <div
          className="rounded-lg p-3 text-sm"
          style={{ background: "rgba(250,178,25,0.10)", color: "var(--text-secondary)" }}
        >
          <strong style={{ color: "var(--warning)" }}>Waiting after repeated failures.</strong>{" "}
          Resuming automatically at{" "}
          <strong>{new Date(campaign.cooldown_until).toLocaleTimeString()}</strong> and retrying the
          addresses that failed (attempt {campaign.cooldown_count} of 3). {campaign.error}
          <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Use Resume to try now instead of waiting.
          </div>
        </div>
      ) : (
        campaign.error && (
          <div
            className="rounded-lg p-3 text-sm"
            style={{ background: "rgba(208,59,59,0.10)", color: "var(--critical)" }}
          >
            ! {campaign.error}
          </div>
        )
      )}

      {/* A badge is too easy to miss, and "no email arrived" after a dry run
          looks exactly like a broken send. */}
      {campaign.dry_run === 1 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{ background: "rgba(250,178,25,0.10)", color: "var(--text-secondary)" }}
        >
          <strong>Dry run — no email was delivered.</strong> These messages were
          generated and logged so you can read them below. To actually send, create a
          new batch on the{" "}
          <Link href="/campaigns" className="underline">
            Send page
          </Link>{" "}
          with <em>Dry run</em> unchecked.
        </div>
      )}

      <Card>
        <Progress
          value={done}
          total={Math.max(1, campaign.target_count)}
          label={run.running && run.current ? `Currently processing ${run.current}` : "Progress"}
        />
      </Card>

      <div className="grid gap-4 sm:grid-cols-4">
        {/* In a dry run nothing is delivered, so calling the count "Sent" reads
            as a successful send that never happened. */}
        <StatTile
          label={campaign.dry_run === 1 ? "Generated" : "Sent"}
          value={campaign.sent.toLocaleString()}
          hint={campaign.dry_run === 1 ? "Dry run — nothing delivered" : undefined}
          tone={campaign.dry_run === 1 ? "neutral" : "good"}
        />
        <StatTile label="Failed" value={campaign.failed.toLocaleString()} tone={campaign.failed > 0 ? "critical" : "neutral"} />
        <StatTile label="Skipped" value={campaign.skipped.toLocaleString()} hint="Already emailed elsewhere" />
        <StatTile label="Target" value={campaign.target_count.toLocaleString()} hint={`${(campaign.send_delay_ms / 1000).toFixed(1)}s delay`} />
      </div>

      <Card title="Messages" subtitle="Newest first — click a row to read the email that was generated">
        {sends.length === 0 ? (
          <Empty>Nothing processed yet.</Empty>
        ) : (
          <div className="space-y-2">
            {sends.map((s) => (
              <div key={s.id} className="rounded-lg" style={{ background: "var(--plane)" }}>
                <button
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"
                  onClick={() => setOpen(open === s.id ? null : s.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.email}</span>
                    <span
                      className="block truncate text-xs"
                      style={{ color: s.error ? "var(--critical)" : "var(--text-secondary)" }}
                    >
                      {s.error ?? s.subject}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge status={s.status} />
                    <span className="tabular text-xs" style={{ color: "var(--text-muted)" }}>
                      {new Date(s.created_at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </button>
                {open === s.id && s.body && (
                  <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: "var(--border)" }}>
                    {s.title && (
                      <div className="mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {s.title}
                      </div>
                    )}
                    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-[0.8rem] leading-relaxed">
                      {s.body}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
