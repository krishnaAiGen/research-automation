import type { PromptConfig } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** What the model writes back: the finished email, subject and body. */
export type GeneratedEmail = { subject: string; body: string };

/**
 * Whether this configuration calls the model at all.
 *
 * The user prompt is the request; with it switched off there is nothing to ask,
 * so the template is rendered and sent exactly as written. The system prompt
 * only shapes the answer, so switching that off alone just drops the system
 * message from the call.
 */
export function usesModel(cfg: Pick<PromptConfig, "use_user_prompt">): boolean {
  return cfg.use_user_prompt !== 0;
}

/**
 * What the model is told about one recipient. A scraped author comes with a
 * paper; a hand-added contact comes with `name` / `notes` and empty paper
 * fields, so a prompt written for such a list should lean on those instead.
 * For conference announcements `notes` doubles as the recipient's research
 * area, and the conference / sender sides come from the config itself.
 */
export type PromptContext = {
  title?: string;
  abstract?: string;
  authors?: string[];
  recipient?: string;
  name?: string;
  notes?: string;
};

/**
 * Every placeholder the prompts may reference. Conference and sender fields
 * render empty when unset on the config — the prompt tells the model to omit
 * missing fields rather than invent them, which empty strings express.
 */
const CONFIG_FIELDS = [
  "conference_name",
  "conference_website",
  "conference_dates",
  "conference_location",
  "submission_deadline",
  "notification_date",
  "camera_ready_deadline",
  "conference_topics",
  "keynote_speakers",
  "organizers",
  "sender_name",
  "sender_affiliation",
  "sender_role",
] as const;

export function buildUserPrompt(cfg: PromptConfig, ctx: PromptContext): string {
  const authors = ctx.authors ?? [];
  const authorLines = authors.map((a, i) => `  ${i + 1}. ${a}`).join("\n") || "  (none provided)";
  let text = cfg.user_prompt
    .replaceAll("{{title}}", ctx.title ?? "")
    .replaceAll("{{abstract}}", ctx.abstract ?? "")
    .replaceAll("{{authors}}", authorLines)
    .replaceAll("{{recipient}}", ctx.recipient || "(unknown)")
    .replaceAll("{{recipient_email}}", ctx.recipient || "")
    .replaceAll("{{recipient_name}}", ctx.name ?? "")
    .replaceAll("{{recipient_research_area}}", ctx.notes ?? "")
    .replaceAll("{{name}}", ctx.name ?? "")
    .replaceAll("{{notes}}", ctx.notes ?? "");

  for (const field of CONFIG_FIELDS) {
    text = text.replaceAll(`{{${field}}}`, (cfg as Record<string, unknown>)[field] as string ?? "");
  }
  return text;
}

/**
 * Ask the model to draft the email for one recipient. Throws on transport or
 * empty-reply failure — the caller counts that recipient as failed and moves on.
 */
export async function generateEmail(
  apiKey: string,
  cfg: PromptConfig,
  ctx: PromptContext,
  signal?: AbortSignal,
): Promise<GeneratedEmail> {
  const messages: { role: string; content: string }[] = [];
  if (cfg.use_system_prompt !== 0 && cfg.system_prompt.trim()) {
    messages.push({ role: "system", content: cfg.system_prompt });
  }
  messages.push({ role: "user", content: buildUserPrompt(cfg, ctx) });

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages,
  };
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
    throw new Error(`OpenRouter ${res.status}: ${detail}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return parseEmailResponse(content, cfg);
}

/**
 * Split the reply into subject and body. The prompt asks for "subject and body
 * only", which in practice arrives as a leading "Subject: ..." line; accept it
 * anywhere in the first few lines so reasoning models that preface a line of
 * prose still parse. With no subject line the whole reply is the body and the
 * subject falls back to a plain invitation line.
 */
export function parseEmailResponse(raw: string, cfg: PromptConfig): GeneratedEmail {
  let content = (raw || "").trim();
  // Reasoning traces sometimes arrive inline rather than in a separate field.
  content = content.replace(/<\/?think>/gi, "").trim();

  const lines = content.split("\n");
  const subjectIdx = lines.findIndex((l, i) => i < 6 && /^subject\s*:/i.test(l.trim()));
  if (subjectIdx === -1) {
    return {
      subject: cfg.conference_name ? `Invitation: ${cfg.conference_name}` : "Conference invitation",
      body: content,
    };
  }
  const subject = lines[subjectIdx].slice(lines[subjectIdx].indexOf(":") + 1).trim();
  const body = lines
    .slice(subjectIdx + 1)
    .join("\n")
    .replace(/^\n+/, "")
    .trim();
  return { subject, body };
}
