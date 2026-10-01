"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, StatTile, Badge, Progress, Empty, LoadError } from "@/components/ui";
import { getJSON, errorMessage } from "@/lib/api";
import { DailyVolume, TrackCoverage, DomainBars } from "@/components/charts";
import type {
  Overview,
  Engagement,
  DayPoint,
  TrackRow,
  DomainRow,
  RecentSend,
  CampaignSummary,
} from "@/lib/stats";

type Stats = {
  overview: Overview;
  engagement: Engagement;
  byDay: DayPoint[];
  byTrack: TrackRow[];
  topDomains: DomainRow[];
  recent: RecentSend[];
  campaigns: CampaignSummary[];
  running: number[];
};

type TrackingSettings = {
  tracking_enabled: boolean;
  tracking_base_url: string;
};

type Health = {
  openrouter: boolean;
  smtp: boolean;
  smtpAddress: string;
  auth: boolean;
  dataImported: boolean;
  papers: number;
  recipients: number;
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tracking, setTracking] = useState<TrackingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadAt, setReloadAt] = useState(0);
  // 90 by default: the imported history predates a 30-day window, and an empty
  // chart on first load reads as "nothing ever happened".
  const [days, setDays] = useState(90);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, h, t] = await Promise.all([
          getJSON<Stats>(`/api/stats?days=${days}`),
          getJSON<Health>("/api/health"),
          getJSON<TrackingSettings>("/api/settings"),
        ]);
        if (!alive) return;
        setStats(s);
        setHealth(h);
        setTracking(t);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(errorMessage(err));
      }
    };
    load();
    // Poll so a running campaign's numbers move without a manual refresh.
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [days, reloadAt]);

  // Only a failure with nothing already on screen replaces the page; once data
  // has loaded, a failed poll leaves the last good numbers up.
  if (error && (!stats || !health)) {
    return <LoadError message={error} onRetry={() => setReloadAt(Date.now())} />;
  }

  if (!stats || !health || !tracking) {
    return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;
  }

  const o = stats.overview;
  const g = stats.engagement;

  return (
    <div className="space-y-5">
      <Setup health={health} />

      <div>
        <h1 className="text-xl font-semibold tracking-tight">Outreach analytics</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {o.papers.toLocaleString()} papers scraped · {o.addresses.toLocaleString()} unique author
          addresses
        </p>
      </div>

      {/* Hero: the headline number is the share of the pool contacted. */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Authors emailed, of every address in the pool
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[2.6rem] font-semibold leading-none">
                {o.contacted.toLocaleString()}
              </span>
              <span className="text-lg" style={{ color: "var(--text-muted)" }}>
                / {o.addresses.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[2rem] font-semibold leading-none" style={{ color: "var(--series-1)" }}>
              {o.pctSent.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              {o.remaining.toLocaleString()} remaining
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Progress value={o.contacted} total={o.addresses} />
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {o.sent.toLocaleString()} emails delivered in total
          {o.sent !== o.contacted && " (a few went to addresses outside the scraped pool)"}.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Delivery rate"
          value={`${o.deliveryRate.toFixed(1)}%`}
          hint={`${o.failed.toLocaleString()} failed of ${(o.sent + o.failed).toLocaleString()} attempts`}
          tone={o.deliveryRate >= 95 ? "good" : o.deliveryRate >= 80 ? "neutral" : "critical"}
        />
        <StatTile
          label="Sent last 7 days"
          value={o.sentLast7.toLocaleString()}
          hint={`${o.sentLast30.toLocaleString()} in the last 30`}
        />
        <StatTile
          label="Dry-run previews"
          value={o.dryRun.toLocaleString()}
          hint="Generated but never delivered"
        />
        <StatTile
          label="Active now"
          value={`${o.activeCampaigns}`}
          hint={`${o.enabledSchedules} schedule${o.enabledSchedules === 1 ? "" : "s"} enabled`}
          tone={o.activeCampaigns > 0 ? "accent" : "neutral"}
        />
      </div>

      <EmailEngagement engagement={g} tracking={tracking} onChanged={() => setReloadAt(Date.now())} />

      <Card
        title="Daily send volume"
        subtitle="Outcome of every attempt, by day"
        right={
          <select
            className="field w-auto text-xs"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Time range"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </select>
        }
      >
        <DailyVolume data={stats.byDay} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Coverage by track" subtitle="Addresses contacted in each venue track">
          <TrackCoverage data={stats.byTrack} />
        </Card>
        <Card title="Top recipient domains" subtitle="Where delivered mail went">
          <DomainBars data={stats.topDomains} />
        </Card>
      </div>

      <Card
        title="Recent activity"
        right={
          <Link href="/recipients" className="text-xs underline" style={{ color: "var(--text-secondary)" }}>
            All recipients
          </Link>
        }
      >
        {stats.recent.length === 0 ? (
          <Empty>Nothing sent yet. Start a batch from the Send page.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  <th className="py-2 text-left font-medium">Recipient</th>
                  <th className="py-2 text-left font-medium">Subject</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Opens · Clicks</th>
                  <th className="py-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--gridline)" }}>
                    <td className="max-w-[220px] truncate py-2" title={r.email}>
                      {r.email}
                    </td>
                    <td
                      className="max-w-[360px] truncate py-2"
                      style={{ color: "var(--text-secondary)" }}
                      title={r.error ? `Error: ${r.error}` : r.subject}
                    >
                      {r.error ? r.error : r.subject || "—"}
                    </td>
                    <td className="py-2">
                      <Badge status={r.status} />
                    </td>
                    <td
                      className="tabular whitespace-nowrap py-2 text-right text-xs"
                      style={{ color: "var(--text-muted)" }}
                      title={`${r.opens} open${r.opens === 1 ? "" : "s"} · ${r.clicks} click${r.clicks === 1 ? "" : "s"}${r.status !== "sent" ? " (tracking only applies to delivered mail)" : ""}`}
                    >
                      {r.opens > 0 ? `👁 ${r.opens}` : "—"}
                      {" · "}
                      {r.clicks > 0 ? `🖱 ${r.clicks}` : "—"}
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

      <Card
        title="Recent batches"
        right={
          <Link href="/campaigns" className="text-xs underline" style={{ color: "var(--text-secondary)" }}>
            Manage
          </Link>
        }
      >
        {stats.campaigns.length === 0 ? (
          <Empty>No batches yet.</Empty>
        ) : (
          <div className="space-y-3">
            {stats.campaigns.map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {c.name}
                    <Badge status={c.status} />
                    {c.dry_run === 1 && <Badge status="dry" />}
                  </span>
                  <span className="tabular text-xs" style={{ color: "var(--text-secondary)" }}>
                    {c.sent.toLocaleString()} / {c.target_count.toLocaleString()}
                    {c.failed > 0 && (
                      <span style={{ color: "var(--critical)" }}> · {c.failed} failed</span>
                    )}
                  </span>
                </div>
                <Progress value={c.sent} total={Math.max(1, c.target_count)} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Setup({ health }: { health: Health }) {
  const problems: string[] = [];
  if (!health.dataImported) problems.push("No papers imported — run `npm run import`.");
  if (!health.openrouter) problems.push("OPENROUTER_API_KEY missing in .env.local.");
  if (!health.smtp) problems.push("GMAIL_ADDRESS / GMAIL_APP_PASSWORD missing — live sends disabled.");
  // Worth saying loudly: unauthenticated plus SMTP configured means anyone who
  // can open this page can send mail from your account.
  if (!health.auth) {
    problems.push(
      health.smtp
        ? "No login configured (AUTH_USERNAME / AUTH_PASSWORD) — anyone who can reach this page can send real email from your account."
        : "No login configured (AUTH_USERNAME / AUTH_PASSWORD) — anyone who can reach this page can use the app.",
    );
  }
  if (problems.length === 0) return null;

  return (
    <div
      className="card p-4"
      style={{ borderColor: "var(--warning)", background: "rgba(250,178,25,0.08)" }}
    >
      <div className="mb-1.5 text-sm font-semibold">⚠ Setup incomplete</div>
      <ul className="list-inside list-disc space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function EmailEngagement({
  engagement,
  tracking,
  onChanged,
}: {
  engagement: Engagement;
  tracking: TrackingSettings;
  onChanged: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(tracking.tracking_base_url);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ msg: string; tone: "ok" | "error" } | null>(null);

  // The parent reloads settings on every poll, which would clobber what the
  // user is typing — adopt incoming values only while not mid-edit.
  useEffect(() => {
    setBaseUrl((current) => (current === tracking.tracking_base_url ? current : tracking.tracking_base_url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking.tracking_base_url]);

  const toggleTracking = async () => {
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracking_enabled: !tracking.tracking_enabled }),
    });
    setSaving(false);
    if (res.ok) onChanged();
    else setNotice({ msg: "Could not update the tracking setting.", tone: "error" });
  };

  const saveBaseUrl = async () => {
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracking_base_url: baseUrl }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setNotice({ msg: "Saved.", tone: "ok" });
      onChanged();
    } else {
      setNotice({ msg: json.error ?? "Save failed", tone: "error" });
    }
  };

  return (
    <Card
      title="Email engagement"
      subtitle="Opens via tracking pixel, clicks via rewritten links — on delivered mail only"
      right={
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={tracking.tracking_enabled}
            disabled={saving}
            onChange={toggleTracking}
          />
          Tracking {tracking.tracking_enabled ? "on" : "off"}
        </label>
      }
    >
      {notice && (
        <p className="mb-3 text-xs" style={{ color: notice.tone === "error" ? "var(--critical)" : "var(--text-muted)" }}>
          {notice.msg}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Open rate"
          value={`${engagement.openRate.toFixed(1)}%`}
          hint={`${engagement.uniqueOpens.toLocaleString()} of ${engagement.tracked.toLocaleString()} delivered`}
          tone={engagement.openRate >= 40 ? "good" : engagement.openRate > 0 ? "neutral" : "neutral"}
        />
        <StatTile
          label="Total opens"
          value={engagement.totalOpens.toLocaleString()}
          hint="Includes repeats and privacy-proxy prefetches"
        />
        <StatTile
          label="Click rate"
          value={`${engagement.clickRate.toFixed(1)}%`}
          hint={`${engagement.uniqueClicks.toLocaleString()} of ${engagement.tracked.toLocaleString()} delivered`}
          tone={engagement.clickRate >= 5 ? "good" : engagement.clickRate > 0 ? "neutral" : "neutral"}
        />
        <StatTile
          label="Total clicks"
          value={engagement.totalClicks.toLocaleString()}
          hint="Real user actions — the reliable signal"
        />
      </div>

      <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
        ⚠ Apple Mail privacy protection prefetches images, so open counts (and this open rate) run
        high — treat clicks as the trustworthy measure of engagement. Tracking is off for anyone
        with images blocked or a text-only client. Under GDPR/ePrivacy, open tracking of cold
        outreach generally needs consent — the toggle above sends future emails untracked when off.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[280px] flex-1">
          <input
            className="field"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://yourdomain.com"
            aria-label="Tracking base URL"
          />
        </div>
        <button className="btn" onClick={saveBaseUrl} disabled={saving}>
          {saving ? "Saving…" : "Save tracking URL"}
        </button>
      </div>
      <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        Where recipients reach /api/track/*. Must be publicly reachable — while testing sends to
        yourself, localhost is fine.
      </p>
    </Card>
  );
}
