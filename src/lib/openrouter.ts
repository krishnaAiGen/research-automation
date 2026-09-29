import { QUERIES_PER_EMAIL } from "./models";
import type { PromptConfig } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type QueryResult = { topic: string; queries: string[]; name: string };

/**
 * What the model is told about one recipient. A scraped author comes with a
 * paper; a hand-added contact comes with `name` / `notes` and empty paper
 * fields, so a prompt written for such a list should lean on those instead.
 */
export type PromptContext = {
  title?: string;
  abstract?: string;
  authors?: string[];
  recipient?: string;
  name?: string;
  notes?: string;
};

export function buildUserPrompt(cfg: PromptConfig, ctx: PromptContext): string {
  const authors = ctx.authors ?? [];
  const authorLines = authors.map((a, i) => `  ${i + 1}. ${a}`).join("\n") || "  (none provided)";
  return cfg.user_prompt
    .replaceAll("{{title}}", ctx.title ?? "")
    .replaceAll("{{abstract}}", ctx.abstract ?? "")
    .replaceAll("{{authors}}", authorLines)
    .replaceAll("{{recipient}}", ctx.recipient || "(unknown)")
    .replaceAll("{{name}}", ctx.name ?? "")
    .replaceAll("{{notes}}", ctx.notes ?? "")
    .replaceAll("{{count}}", String(QUERIES_PER_EMAIL));
}

/**
 * Ask the model for a topic phrase, N research queries, and the greeting name
 * it matched to the recipient address. Throws on transport or parse failure —
 * the caller counts that paper as failed and moves on.
 */
export async function generateQueries(
  apiKey: string,
  cfg: PromptConfig,
  ctx: PromptContext,
  signal?: AbortSignal,
): Promise<QueryResult> {
  try {
    return await callModel(apiKey, cfg, ctx, true, signal);
  } catch (err) {
    // Not every model takes response_format — the `:free` variants generally
    // don't. The prompts already ask for JSON in words, and the parser digs
    // it out of prose, so dropping the parameter costs nothing but a retry.
    if (err instanceof ResponseFormatUnsupported) {
      return await callModel(apiKey, cfg, ctx, false, signal);
    }
    throw err;
  }
}

class ResponseFormatUnsupported extends Error {}

async function callModel(
  apiKey: string,
  cfg: PromptConfig,
  ctx: PromptContext,
  jsonMode: boolean,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: "system", content: cfg.system_prompt },
      { role: "user", content: buildUserPrompt(cfg, ctx) },
    ],
  };
  if (jsonMode) payload.response_format = { type: "json_object" };
  if (cfg.reasoning) payload.reasoning = { enabled: true };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (jsonMode && res.status >= 400 && res.status < 500 && /response_format/i.test(detail)) {
      throw new ResponseFormatUnsupported(detail);
    }
    throw new Error(`OpenRouter ${res.status}: ${detail}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return parseQueryResponse(content);
}

/**
 * Pull the first complete JSON value out of a longer string, tracking string
 * literals and escapes so a brace inside a query doesn't end the scan early.
 * Reasoning models narrate before answering, and without `response_format` to
 * hold them to it the JSON arrives buried in that prose.
 */
function extractJson(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString) {
        if (ch === open) depth++;
        else if (ch === close && --depth === 0) return text.slice(i, j + 1);
      }
    }
  }
  return null;
}

export function parseQueryResponse(raw: string): QueryResult {
  let content = (raw || "").trim();

  // Reasoning traces sometimes arrive inline rather than in a separate field.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // A fenced block anywhere, not only at the very start.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  if (fenced) content = fenced[1].trim();

  let topic = "";
  let rawQueries: unknown[] = [];
  let name = "";

  const parsed = tryParse(content) ?? tryParse(extractJson(content) ?? "");
  if (Array.isArray(parsed)) {
    rawQueries = parsed;
  } else if (parsed && typeof parsed === "object") {
    const data = parsed as Record<string, unknown>;
    topic = String(data.topic ?? "").trim();
    rawQueries = Array.isArray(data.queries) ? data.queries : [];
    name = String(data.name ?? "").trim();
  } else {
    // Last resort: treat each non-empty line as a query.
    rawQueries = content.split("\n").map((l) => l.replace(/^[\s\-•\t]+/, "").trim());
  }

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const q of rawQueries) {
    const s = String(q).trim().replace(/^"|"$/g, "");
    const low = s.toLowerCase();
    if (s && !seen.has(low)) {
      seen.add(low);
      queries.push(s);
    }
  }
  if (queries.length === 0) {
    throw new Error(`No queries parsed from model reply: ${content.slice(0, 200)}`);
  }

  // Guard against the model returning a full name — keep only the given name.
  name = name ? name.split(/\s+/)[0] : "";
  return { topic, queries, name };
}

function tryParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
