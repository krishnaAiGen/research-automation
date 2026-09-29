"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty, Field, Toast, Progress, LoadError } from "@/components/ui";
import { getJSON, errorMessage } from "@/lib/api";
import type { CollectionSummary } from "@/lib/types";

type Row = {
  id: number;
  email: string;
  name: string;
  notes: string;
  position: number;
  source: "import" | "manual";
  paper_id: string | null;
  title: string | null;
  track: string | null;
  sent: number;
  sent_at: string | null;
};

export default function RecipientsPage() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [tracks, setTracks] = useState<string[]>([]);
  const [track, setTrack] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [rename, setRename] = useState("");
  const [newName, setNewName] = useState("");
  const [addForm, setAddForm] = useState({ emails: "", name: "", notes: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "error" }>({ msg: "", tone: "ok" });
  const [error, setError] = useState<string | null>(null);

  const active = collections.find((c) => c.id === activeId) ?? null;

  const loadCollections = useCallback(async (keepId?: number) => {
    try {
      const d = await getJSON<{ collections: CollectionSummary[]; defaultId: number }>(
        "/api/collections",
      );
      setCollections(d.collections);
      setActiveId((current) => {
        const want = keepId ?? current ?? d.defaultId;
        return d.collections.some((c) => c.id === want) ? want : d.defaultId;
      });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    loadCollections();
    // Tracks are a nicety — a failure here must not take the page down.
    getJSON<{ tracks?: string[] }>("/api/campaigns")
      .then((d) => setTracks(d.tracks ?? []))
      .catch(() => setTracks([]));
  }, [loadCollections]);

  useEffect(() => {
    setRename(active?.name ?? "");
  }, [active?.id, active?.name]);

  useEffect(() => {
    if (!activeId) return;
    setLoading(true);
    // Debounce so typing in the search box doesn't fire a query per keystroke.
    const t = setTimeout(() => {
      const params = new URLSearchParams({
        q,
        status,
        track,
        page: String(page),
        collection_id: String(activeId),
      });
      getJSON<{ rows: Row[]; total: number; pages: number }>(`/api/recipients?${params}`)
        .then((d) => {
          setRows(d.rows);
          setTotal(d.total);
          setPages(d.pages);
          setLoading(false);
          setSelected(new Set());
          setError(null);
        })
        .catch((err) => {
          setLoading(false);
          setError(errorMessage(err));
        });
    }, 250);
    return () => clearTimeout(t);
  }, [q, status, track, page, activeId]);

  /** After a write: re-read the collection counts and the current page of rows. */
  const refresh = async () => {
    if (!activeId) return;
    const params = new URLSearchParams({
      q,
      status,
      track,
      page: String(page),
      collection_id: String(activeId),
    });
    try {
      const [, d] = await Promise.all([
        loadCollections(activeId),
        getJSON<{ rows: Row[]; total: number; pages: number }>(`/api/recipients?${params}`),
      ]);
      setRows(d.rows);
      setTotal(d.total);
      setPages(d.pages);
      setSelected(new Set());
    } catch (err) {
      setToast({ msg: errorMessage(err), tone: "error" });
    }
  };

  const resetPage = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy("create");
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Failed", tone: "error" });
    setNewName("");
    await loadCollections(json.collection.id);
    resetPage(() => {
      setQ("");
      setStatus("all");
      setTrack("");
    });
    setToast({ msg: `Collection "${json.collection.name}" created.`, tone: "ok" });
  };

  const saveName = async () => {
    if (!active || !rename.trim() || rename.trim() === active.name) return;
    setBusy("rename");
    const res = await fetch(`/api/collections/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: rename }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Failed", tone: "error" });
    await loadCollections(active.id);
    setToast({ msg: "Collection renamed.", tone: "ok" });
  };

  const removeCollection = async () => {
    if (!active) return;
    setBusy("delete-collection");
    const res = await fetch(`/api/collections/${active.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Failed", tone: "error" });
    setActiveId(null);
    await loadCollections();
    setToast({ msg: "Collection deleted.", tone: "ok" });
  };

  const addEmails = async () => {
    if (!active || !addForm.emails.trim()) return;
    setBusy("add");
    const res = await fetch("/api/recipients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_id: active.id, ...addForm }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Failed", tone: "error" });

    const parts = [`${json.added} address${json.added === 1 ? "" : "es"} added`];
    if (json.duplicates?.length) parts.push(`${json.duplicates.length} already in this collection`);
    if (json.invalid?.length) parts.push(`${json.invalid.length} rejected as invalid`);
    setToast({ msg: `${parts.join(", ")}.`, tone: json.added > 0 ? "ok" : "error" });
    setAddForm({ emails: "", name: "", notes: "" });
    await refresh();
  };

  const removeIds = async (ids: number[]) => {
    if (!active || ids.length === 0) return;
    setBusy("remove");
    const res = await fetch("/api/recipients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_id: active.id, ids }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Failed", tone: "error" });
    setToast({ msg: `${json.removed} removed from the collection.`, tone: "ok" });
    await refresh();
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const emailCount = addForm.emails.split(/[,;\s]+/).filter(Boolean).length;

  if (error && collections.length === 0) {
    return <LoadError message={error} onRetry={() => loadCollections()} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Recipients</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Addresses live in collections. The scraped author pool is one; build others by hand and
          point a batch or a schedule at whichever you want.
        </p>
      </div>

      <Toast message={toast.msg} tone={toast.tone} />

      <Card title="Collections">
        <div className="flex flex-wrap items-center gap-2">
          {collections.map((c) => {
            const on = c.id === activeId;
            return (
              <button
                key={c.id}
                className="btn"
                onClick={() => {
                  setActiveId(c.id);
                  resetPage(() => {
                    setQ("");
                    setStatus("all");
                    setTrack("");
                  });
                }}
                style={
                  on
                    ? { background: "var(--series-1)", borderColor: "var(--series-1)", color: "#fff" }
                    : undefined
                }
              >
                {c.name}
                <span className="tabular ml-2 opacity-70">{c.total.toLocaleString()}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <input
            className="field max-w-xs"
            placeholder="New collection name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createCollection()}
          />
          <button
            className="btn"
            onClick={createCollection}
            disabled={busy === "create" || !newName.trim()}
          >
            + New collection
          </button>
        </div>
      </Card>

      {active && (
        <>
          <Card
            title={active.name}
            subtitle={
              active.paper_backed > 0
                ? `${active.paper_backed.toLocaleString()} from scraped papers · ${(active.total - active.paper_backed).toLocaleString()} added by hand`
                : "Hand-built list — no papers behind these addresses"
            }
            right={active.is_default === 1 ? <Badge status="active" /> : undefined}
          >
            <div className="space-y-4">
              <Progress
                value={active.contacted}
                total={Math.max(1, active.total)}
                label={`${active.contacted.toLocaleString()} of ${active.total.toLocaleString()} already emailed · ${active.pending.toLocaleString()} available to send now`}
              />

              <div className="flex flex-wrap items-end gap-2">
                <Field label="Collection name">
                  <input
                    className="field"
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveName()}
                  />
                </Field>
                <button
                  className="btn"
                  onClick={saveName}
                  disabled={busy === "rename" || !rename.trim() || rename.trim() === active.name}
                >
                  Save name
                </button>
                <button
                  className="btn btn-danger ml-auto"
                  onClick={removeCollection}
                  disabled={busy === "delete-collection" || active.is_default === 1}
                  title={
                    active.is_default === 1
                      ? "The scraped pool cannot be deleted — rename it instead."
                      : "Delete this collection and its addresses"
                  }
                >
                  Delete collection
                </button>
              </div>
            </div>
          </Card>

          <Card
            title="Add addresses"
            subtitle="One address, or many separated by commas. Newlines and semicolons work too."
          >
            <div className="space-y-4">
              <Field
                label="Email addresses"
                hint={
                  emailCount > 1
                    ? `${emailCount} addresses detected — bulk add, so the greeting name is left to the model`
                    : "e.g. a@lab.edu, b@uni.ac.uk, c@example.com"
                }
              >
                <textarea
                  className="field"
                  rows={4}
                  placeholder="a@lab.edu, b@uni.ac.uk"
                  value={addForm.emails}
                  onChange={(e) => setAddForm({ ...addForm, emails: e.target.value })}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Greeting name"
                  hint={
                    emailCount > 1
                      ? "Only used when adding a single address"
                      : "Fills {First Name} in the template"
                  }
                >
                  <input
                    className="field"
                    placeholder="Kenji"
                    value={addForm.name}
                    disabled={emailCount > 1}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  />
                </Field>
                <Field label="Notes for the model" hint="Available to prompts as {{notes}}">
                  <input
                    className="field"
                    placeholder="Works on federated learning at Kyoto"
                    value={addForm.notes}
                    onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                  />
                </Field>
              </div>

              {active.paper_backed === 0 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  These addresses have no paper behind them, so <code>{"{{title}}"}</code> and{" "}
                  <code>{"{{abstract}}"}</code> render empty. Give this collection its own prompt
                  configuration — one written around <code>{"{{name}}"}</code> and{" "}
                  <code>{"{{notes}}"}</code> — rather than reusing the paper prompt.
                </p>
              )}

              <button
                className="btn btn-primary"
                onClick={addEmails}
                disabled={busy === "add" || !addForm.emails.trim()}
              >
                {busy === "add"
                  ? "Adding…"
                  : `Add ${emailCount || 0} address${emailCount === 1 ? "" : "es"}`}
              </button>
            </div>
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <input
                className="field max-w-xs"
                placeholder="Search address, name, or paper…"
                value={q}
                onChange={(e) => resetPage(() => setQ(e.target.value))}
              />
              <select
                className="field w-auto"
                value={status}
                onChange={(e) => resetPage(() => setStatus(e.target.value))}
              >
                <option value="all">All</option>
                <option value="sent">Emailed</option>
                <option value="pending">Not yet emailed</option>
              </select>
              {active.paper_backed > 0 && (
                <select
                  className="field w-auto"
                  value={track}
                  onChange={(e) => resetPage(() => setTrack(e.target.value))}
                >
                  <option value="">All tracks</option>
                  {tracks.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
              {selected.size > 0 && (
                <button
                  className="btn btn-danger"
                  onClick={() => removeIds([...selected])}
                  disabled={busy === "remove"}
                >
                  Remove {selected.size} selected
                </button>
              )}
              <span className="tabular ml-auto text-xs" style={{ color: "var(--text-secondary)" }}>
                {total.toLocaleString()} match{total === 1 ? "" : "es"}
              </span>
            </div>

            {loading && rows.length === 0 ? (
              <Empty>Loading…</Empty>
            ) : rows.length === 0 ? (
              <Empty>
                {total === 0 && !q && status === "all" && !track
                  ? "This collection is empty — add addresses above."
                  : "Nothing matches those filters."}
              </Empty>
            ) : (
              <div className="scroll-x">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      <th className="w-8 py-2 text-left font-medium">
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          aria-label="Select all on this page"
                          onChange={(e) =>
                            setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                          }
                        />
                      </th>
                      <th className="py-2 text-left font-medium">Address</th>
                      <th className="py-2 text-left font-medium">Paper / notes</th>
                      <th className="py-2 text-left font-medium">State</th>
                      <th className="py-2 text-right font-medium">Emailed</th>
                      <th className="py-2 text-right font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--gridline)" }}>
                        <td className="py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            aria-label={`Select ${r.email}`}
                            onChange={() => toggle(r.id)}
                          />
                        </td>
                        <td className="max-w-[240px] truncate py-2" title={r.email}>
                          {r.email}
                          {r.name && (
                            <span className="ml-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                              ({r.name})
                            </span>
                          )}
                        </td>
                        <td
                          className="max-w-[380px] truncate py-2"
                          style={{ color: "var(--text-secondary)" }}
                          title={r.title ?? r.notes}
                        >
                          {r.title ?? (r.notes || "—")}
                        </td>
                        <td className="py-2">
                          <Badge status={r.sent ? "sent" : "draft"} />
                        </td>
                        <td
                          className="tabular whitespace-nowrap py-2 text-right text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {r.sent_at
                            ? new Date(r.sent_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            className="btn"
                            onClick={() => removeIds([r.id])}
                            disabled={busy === "remove"}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Previous
                </button>
                <span className="tabular text-xs" style={{ color: "var(--text-secondary)" }}>
                  Page {page.toLocaleString()} of {pages.toLocaleString()}
                </span>
                <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
