"use client";

import React from "react";

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[0.95rem] font-semibold">{title}</h2>}
            {subtitle && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "critical" | "accent";
}) {
  const color =
    tone === "good"
      ? "var(--success-text)"
      : tone === "critical"
        ? "var(--critical)"
        : tone === "accent"
          ? "var(--series-1)"
          : "var(--text-primary)";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div className="mt-1.5 text-[1.75rem] font-semibold leading-none" style={{ color }}>
        {value}
      </div>
      {hint && (
        <div className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function Badge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; icon: string }> = {
    running: { bg: "rgba(42,120,214,0.14)", fg: "var(--series-1)", icon: "▶" },
    queued: { bg: "rgba(42,120,214,0.10)", fg: "var(--series-1)", icon: "•" },
    completed: { bg: "rgba(12,163,12,0.14)", fg: "var(--success-text)", icon: "✓" },
    sent: { bg: "rgba(12,163,12,0.14)", fg: "var(--success-text)", icon: "✓" },
    active: { bg: "rgba(12,163,12,0.14)", fg: "var(--success-text)", icon: "✓" },
    paused: { bg: "rgba(250,178,25,0.18)", fg: "#8a6100", icon: "❚❚" },
    draft: { bg: "var(--plane)", fg: "var(--text-secondary)", icon: "○" },
    dry: { bg: "var(--plane)", fg: "var(--text-secondary)", icon: "◌" },
    cancelled: { bg: "var(--plane)", fg: "var(--text-muted)", icon: "×" },
    failed: { bg: "rgba(208,59,59,0.14)", fg: "var(--critical)", icon: "!" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium"
      style={{ background: s.bg, color: s.fg }}
    >
      <span aria-hidden>{s.icon}</span>
      {status}
    </span>
  );
}

export function Progress({
  value,
  total,
  label,
  color = "var(--series-1)",
}: {
  value: number;
  total: number;
  label?: string;
  color?: string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span style={{ color: "var(--text-secondary)" }}>{label}</span>
          <span className="tabular font-medium">
            {value.toLocaleString()} / {total.toLocaleString()} ({pct.toFixed(1)}%)
          </span>
        </div>
      )}
      <div
        className="h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--gridline)" }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color, transition: "width .3s ease" }}
        />
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[0.7rem]" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

export function Toast({ message, tone }: { message: string; tone: "ok" | "error" }) {
  if (!message) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-sm"
      role="status"
      style={{
        background: tone === "ok" ? "rgba(12,163,12,0.12)" : "rgba(208,59,59,0.12)",
        color: tone === "ok" ? "var(--success-text)" : "var(--critical)",
      }}
    >
      {tone === "ok" ? "✓ " : "! "}
      {message}
    </div>
  );
}
