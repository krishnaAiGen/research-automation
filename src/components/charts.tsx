"use client";

import React, { useRef, useState } from "react";
import type { DayPoint, TrackRow, DomainRow } from "@/lib/stats";

const SENT = "var(--series-1)";
const FAILED = "var(--critical)";

// One viewBox, scaled to the container. Pointer x is converted back through the
// measured rect so hit-testing stays correct at any width.
const VB_W = 1000;

function useHover<T>() {
  const [hover, setHover] = useState<{ x: number; y: number; datum: T } | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const toVb = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * VB_W;
  };
  return { hover, setHover, ref, toVb };
}

function Tooltip({
  x,
  width,
  children,
}: {
  x: number;
  width: number;
  children: React.ReactNode;
}) {
  // Keep the bubble inside the plot when hovering near either edge.
  const left = Math.min(Math.max((x / VB_W) * 100, 6), 94);
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 rounded-lg px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        left: `${left}%`,
        transform: "translateX(-50%)",
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        minWidth: width,
      }}
    >
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-4">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function shortDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Daily send volume — stacked bars, sent + failed                      */
/* ------------------------------------------------------------------ */
export function DailyVolume({ data }: { data: DayPoint[] }) {
  const { hover, setHover, ref, toVb } = useHover<DayPoint>();
  const [showTable, setShowTable] = useState(false);

  const H = 240;
  const PAD = { top: 14, right: 12, bottom: 26, left: 44 };
  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = Math.max(1, ...data.map((d) => d.sent + d.failed));
  const step = plotW / Math.max(1, data.length);
  const barW = Math.max(3, step * 0.66);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  const idxAt = (vbX: number) => {
    const i = Math.floor((vbX - PAD.left) / step);
    return i >= 0 && i < data.length ? i : null;
  };

  const total = data.reduce((s, d) => s + d.sent, 0);

  return (
    <div>
      <div className="flex items-start justify-between">
        <Legend
          items={[
            { label: "Sent", color: SENT },
            { label: "Failed", color: FAILED },
          ]}
        />
        <button
          className="text-xs underline"
          style={{ color: "var(--text-secondary)" }}
          onClick={() => setShowTable((s) => !s)}
        >
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {showTable ? (
        <div className="scroll-x max-h-[240px] overflow-y-auto">
          <table className="w-full text-xs tabular">
            <thead>
              <tr style={{ color: "var(--text-secondary)" }}>
                <th className="py-1 text-left font-medium">Day</th>
                <th className="py-1 text-right font-medium">Sent</th>
                <th className="py-1 text-right font-medium">Failed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} style={{ borderTop: "1px solid var(--gridline)" }}>
                  <td className="py-1">{shortDay(d.day)}</td>
                  <td className="py-1 text-right">{d.sent}</td>
                  <td className="py-1 text-right">{d.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={ref}
            viewBox={`0 0 ${VB_W} ${H}`}
            width="100%"
            role="img"
            aria-label={`Daily email volume, ${total} sent over ${data.length} days`}
            onMouseMove={(e) => {
              const vbX = toVb(e.clientX);
              const i = idxAt(vbX);
              setHover(i === null ? null : { x: PAD.left + i * step + step / 2, y: 0, datum: data[i] });
            }}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={VB_W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--gridline)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--text-muted)"
                  className="tabular"
                >
                  {t}
                </text>
              </g>
            ))}

            {data.map((d, i) => {
              const cx = PAD.left + i * step + (step - barW) / 2;
              const sentH = (d.sent / max) * plotH;
              const failH = (d.failed / max) * plotH;
              const active = hover?.datum.day === d.day;
              return (
                <g key={d.day} opacity={hover && !active ? 0.55 : 1}>
                  {d.sent > 0 && (
                    <rect
                      x={cx}
                      y={y(d.sent)}
                      width={barW}
                      height={Math.max(2, sentH)}
                      rx={3}
                      fill={SENT}
                    />
                  )}
                  {d.failed > 0 && (
                    // 2px surface gap keeps the two fills from reading as one.
                    <rect
                      x={cx}
                      y={y(d.sent + d.failed)}
                      width={barW}
                      height={Math.max(2, failH - 2)}
                      rx={3}
                      fill={FAILED}
                    />
                  )}
                </g>
              );
            })}

            <line
              x1={PAD.left}
              x2={VB_W - PAD.right}
              y1={PAD.top + plotH}
              y2={PAD.top + plotH}
              stroke="var(--baseline)"
              strokeWidth={1}
            />

            {data.map((d, i) =>
              i % Math.ceil(data.length / 8) === 0 ? (
                <text
                  key={d.day}
                  x={PAD.left + i * step + step / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {shortDay(d.day)}
                </text>
              ) : null,
            )}
          </svg>

          {hover && (
            <Tooltip x={hover.x} width={128}>
              <div className="font-medium">{shortDay(hover.datum.day)}</div>
              <div className="tabular" style={{ color: "var(--text-secondary)" }}>
                {hover.datum.sent} sent
                {hover.datum.failed > 0 ? ` · ${hover.datum.failed} failed` : ""}
              </div>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Coverage by track — horizontal progress bars                         */
/* ------------------------------------------------------------------ */
export function TrackCoverage({ data }: { data: TrackRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        No papers imported yet.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {data.map((t) => {
        const pct = t.addresses > 0 ? (t.sent / t.addresses) * 100 : 0;
        return (
          <div key={t.track}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-medium">{t.track || "(untracked)"}</span>
              <span className="tabular whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {t.sent.toLocaleString()} / {t.addresses.toLocaleString()} · {pct.toFixed(1)}%
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--gridline)" }}
            >
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SENT }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Top recipient domains — single-series horizontal bars                */
/* ------------------------------------------------------------------ */
export function DomainBars({ data }: { data: DomainRow[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Nothing sent yet.
      </p>
    );
  }
  const max = Math.max(...data.map((d) => d.n));
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div
          key={d.domain}
          className="grid items-center gap-3"
          style={{ gridTemplateColumns: "minmax(0,1fr) 3.2rem" }}
          onMouseEnter={() => setHoverIdx(i)}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <div>
            <div className="mb-1 truncate text-xs" title={d.domain}>
              {d.domain}
            </div>
            <div className="h-2 w-full rounded-full" style={{ background: "var(--gridline)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(d.n / max) * 100}%`,
                  background: SENT,
                  opacity: hoverIdx === null || hoverIdx === i ? 1 : 0.6,
                }}
              />
            </div>
          </div>
          <div className="tabular text-right text-xs" style={{ color: "var(--text-secondary)" }}>
            {d.n.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
