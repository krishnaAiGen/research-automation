"use client";

import { useEffect, useState } from "react";
import { Card, Field, Toast, Badge } from "@/components/ui";
import { MODEL_CHOICES, QUERIES_PER_EMAIL } from "@/lib/models";
import type { PromptConfig } from "@/lib/types";

type Preview = {
  paper: { id: string; title: string; track: string; authors: string[]; recipient: string; abstract: string };
  resolvedUserPrompt: string;
  topic: string;
  queries: string[];
  greeting: string;
  subject: string;
  body: string;
  modelError: string | null;
};

export default function PromptPage() {
  const [configs, setConfigs] = useState<PromptConfig[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PromptConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "error" }>({ msg: "", tone: "ok" });

  const load = async (keepId?: number) => {
    const { configs } = (await fetch("/api/prompts").then((r) => r.json())) as {
      configs: PromptConfig[];
    };
    setConfigs(configs);
    const pick = configs.find((c) => c.id === keepId) ?? configs.find((c) => c.is_active) ?? configs[0];
    if (pick) {
      setSelectedId(pick.id);
      setDraft({ ...pick });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const dirty =
    draft != null && JSON.stringify(draft) !== JSON.stringify(configs.find((c) => c.id === draft.id));

  const set = <K extends keyof PromptConfig>(key: K, value: PromptConfig[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async (activate = false) => {
    if (!draft) return;
    setBusy("save");
    const res = await fetch(`/api/prompts/${draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, is_active: activate || draft.is_active === 1 }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Save failed", tone: "error" });
    await load(draft.id);
    setToast({ msg: "Prompt saved.", tone: "ok" });
  };

  const create = async () => {
    setBusy("create");
    const res = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, name: `${draft?.name ?? "Prompt"} (copy)` }),
    });
    const { config } = await res.json();
    setBusy(null);
    await load(config.id);
    setToast({ msg: "New prompt created.", tone: "ok" });
  };

  /**
   * A hand-built collection has no paper, so the paper prompts render empty
   * titles and abstracts. This starts from a set written around the name and
   * notes instead, carrying over the URLs so they need not be re-entered.
   */
  const createForContacts = async () => {
    setBusy("create-contact");
    const res = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: "contact",
        model: draft?.model,
        reasoning: draft?.reasoning,
        product_url: draft?.product_url,
        demo_url: draft?.demo_url,
      }),
    });
    const { config } = await res.json();
    setBusy(null);
    setPreview(null);
    await load(config.id);
    setToast({ msg: "Starter prompt for a hand-built list created.", tone: "ok" });
  };

  const remove = async () => {
    if (!draft) return;
    setBusy("delete");
    const res = await fetch(`/api/prompts/${draft.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Delete failed", tone: "error" });
    await load();
    setToast({ msg: "Prompt deleted.", tone: "ok" });
  };

  const runPreview = async (live: boolean, samePaper: boolean) => {
    if (!draft) return;
    setBusy(live ? "preview-live" : "preview");
    const res = await fetch("/api/prompts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: draft,
        live,
        paper_id: samePaper ? preview?.paper.id : undefined,
      }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setToast({ msg: json.error ?? "Preview failed", tone: "error" });
    setPreview(json);
    if (json.modelError) setToast({ msg: json.modelError, tone: "error" });
  };

  if (!draft) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;

  // Distinct {query N} lines in the template. The model always writes
  // QUERIES_PER_EMAIL of them, so a template with a different number of slots
  // either wastes generated queries or has slot lines stripped from the email.
  const querySlots = new Set(
    [...draft.template.matchAll(/\{query (\d+)\}/g)].map((m) => Number(m[1])),
  ).size;
  const slotMismatch =
    querySlots === QUERIES_PER_EMAIL
      ? null
      : querySlots < QUERIES_PER_EMAIL
        ? `${QUERIES_PER_EMAIL - querySlots} of the ${QUERIES_PER_EMAIL} generated queries will be thrown away — this template has only ${querySlots} {query N} line${querySlots === 1 ? "" : "s"}.`
        : `${querySlots - QUERIES_PER_EMAIL} {query N} line${querySlots - QUERIES_PER_EMAIL === 1 ? "" : "s"} will be dropped from the email — only ${QUERIES_PER_EMAIL} queries are generated.`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Email prompt</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            The model turns each paper into a topic, research queries, and a greeting name. The
            template turns those into the email that gets sent. Keep as many configurations as you
            like — every batch and schedule picks the one it wants, so a hand-built recipient list
            can have its own without touching this one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="field w-auto"
            value={selectedId ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSelectedId(id);
              const c = configs.find((x) => x.id === id);
              if (c) setDraft({ ...c });
              setPreview(null);
            }}
          >
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.is_active ? " (active)" : ""}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={create}
            disabled={busy === "create"}
            title="Copy this configuration into a new one — batches and schedules each pick their own"
          >
            Duplicate
          </button>
          <button
            className="btn"
            onClick={createForContacts}
            disabled={busy === "create-contact"}
            title="A starter configuration for a hand-built recipient list, which has no paper behind it"
          >
            New for a hand-built list
          </button>
        </div>
      </div>

      <Toast message={toast.msg} tone={toast.tone} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card
            title="Settings"
            right={draft.is_active === 1 ? <Badge status="active" /> : undefined}
          >
            <div className="space-y-4">
              <Field label="Name">
                <input
                  className="field"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </Field>
              <Field
                label="Model"
                hint={
                  MODEL_CHOICES.find((m) => m.id === draft.model)?.note ??
                  "Not one of the listed models — kept as it is until you pick another."
                }
              >
                <select
                  className="field"
                  value={draft.model}
                  onChange={(e) => set("model", e.target.value)}
                >
                  {MODEL_CHOICES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {/* Never silently rewrite a model the list doesn't know. */}
                  {!MODEL_CHOICES.some((m) => m.id === draft.model) && (
                    <option value={draft.model}>{draft.model} (current)</option>
                  )}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Product URL">
                  <input
                    className="field"
                    value={draft.product_url}
                    onChange={(e) => set("product_url", e.target.value)}
                  />
                </Field>
                <Field label="Demo URL">
                  <input
                    className="field"
                    value={draft.demo_url}
                    onChange={(e) => set("demo_url", e.target.value)}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.reasoning === 1}
                  onChange={(e) => set("reasoning", e.target.checked ? 1 : 0)}
                />
                Enable model reasoning tokens
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  (slower, costs more)
                </span>
              </label>
            </div>
          </Card>

          <Card title="System prompt" subtitle="How the model is told to think about each paper">
            <textarea
              className="field"
              rows={16}
              value={draft.system_prompt}
              onChange={(e) => set("system_prompt", e.target.value)}
            />
          </Card>

          <Card
            title="User prompt"
            subtitle="Sent per paper. Placeholders are substituted before the call."
          >
            <textarea
              className="field"
              rows={12}
              value={draft.user_prompt}
              onChange={(e) => set("user_prompt", e.target.value)}
            />
          </Card>

          <Card
            title="Email template"
            subtitle={`A leading 'Subject:' line sets the subject. The model writes ${QUERIES_PER_EMAIL} research queries, which fill the {query 1}…{query ${QUERIES_PER_EMAIL}} lines.`}
          >
            <textarea
              className="field"
              rows={22}
              value={draft.template}
              onChange={(e) => set("template", e.target.value)}
            />
            {slotMismatch && (
              <p className="mt-2 text-xs" style={{ color: "var(--warning)" }}>
                {slotMismatch}
              </p>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" onClick={() => save(false)} disabled={busy === "save"}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            {draft.is_active !== 1 && (
              <button className="btn" onClick={() => save(true)} disabled={busy === "save"}>
                Save &amp; make active
              </button>
            )}
            <button className="btn btn-danger" onClick={remove} disabled={busy === "delete"}>
              Delete
            </button>
            {dirty && (
              <span className="text-xs" style={{ color: "var(--warning)" }}>
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div className="space-y-5 lg:sticky lg:top-[68px] lg:self-start">
          <Card
            title="Preview"
            subtitle="Renders against a real scraped paper"
            right={
              <div className="flex gap-2">
                <button
                  className="btn"
                  onClick={() => runPreview(false, false)}
                  disabled={busy?.startsWith("preview")}
                >
                  Random paper
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => runPreview(true, Boolean(preview))}
                  disabled={busy?.startsWith("preview")}
                  title="Calls the model for real queries"
                >
                  {busy === "preview-live" ? "Generating…" : "Generate with model"}
                </button>
              </div>
            }
          >
            {!preview ? (
              <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                Pick a paper to see the rendered email.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg p-3 text-xs" style={{ background: "var(--plane)" }}>
                  <div className="font-medium">{preview.paper.title}</div>
                  <div className="mt-1" style={{ color: "var(--text-secondary)" }}>
                    {preview.paper.track} · {preview.paper.authors.slice(0, 3).join(", ")}
                    {preview.paper.authors.length > 3 ? " …" : ""}
                  </div>
                  <div className="mt-1" style={{ color: "var(--text-muted)" }}>
                    → {preview.paper.recipient || "no address on this paper"}
                  </div>
                </div>

                {preview.modelError && (
                  <Toast message={preview.modelError} tone="error" />
                )}

                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  <span className="font-medium">Greeting:</span> {preview.greeting} ·{" "}
                  <span className="font-medium">Topic:</span> {preview.topic}
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Subject
                  </div>
                  <div className="rounded-lg p-2.5 text-sm" style={{ background: "var(--plane)" }}>
                    {preview.subject}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Body
                  </div>
                  <pre
                    className="max-h-[440px] overflow-auto whitespace-pre-wrap rounded-lg p-3 text-[0.8rem] leading-relaxed"
                    style={{ background: "var(--plane)" }}
                  >
                    {preview.body}
                  </pre>
                </div>

                <details>
                  <summary className="cursor-pointer text-xs" style={{ color: "var(--text-secondary)" }}>
                    Resolved user prompt sent to the model
                  </summary>
                  <pre
                    className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-lg p-3 text-[0.75rem]"
                    style={{ background: "var(--plane)" }}
                  >
                    {preview.resolvedUserPrompt}
                  </pre>
                </details>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
