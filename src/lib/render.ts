import type { PromptConfig } from "./types";

export type RenderedEmail = { subject: string; body: string };

/** The recipient-side inputs a template may reference. */
export type RenderContext = {
  email: string;
  name: string;
  /** The recipient's research area — the notes field on hand-added contacts. */
  researchArea: string;
};

/** The recipient's given name, or the neutral fallback the prompts specify. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first || "Researcher";
}

/**
 * Fill the template placeholders. The conference and sender fields come from
 * the configuration; the recipient side comes from the queue row. A leading
 * "Subject: ..." line sets the subject and is stripped from the body.
 * Unset fields render empty — the prompt tells the model to omit missing
 * details, and the template stays honest the same way.
 */
export function renderEmail(cfg: PromptConfig, ctx: RenderContext): RenderedEmail {
  const values: Record<string, string> = {
    conference_name: cfg.conference_name,
    conference_website: cfg.conference_website,
    conference_dates: cfg.conference_dates,
    conference_location: cfg.conference_location,
    submission_deadline: cfg.submission_deadline,
    notification_date: cfg.notification_date,
    camera_ready_deadline: cfg.camera_ready_deadline,
    conference_topics: cfg.conference_topics,
    keynote_speakers: cfg.keynote_speakers,
    organizers: cfg.organizers,
    sender_name: cfg.sender_name,
    sender_affiliation: cfg.sender_affiliation,
    sender_role: cfg.sender_role,
    recipient_name: ctx.name,
    recipient_email: ctx.email,
    recipient_research_area: ctx.researchArea,
    first_name: firstName(ctx.name),
  };

  let filled = cfg.template;
  for (const [key, value] of Object.entries(values)) {
    filled = filled.replaceAll(`{{${key}}}`, value);
  }

  let subject = cfg.conference_name ? `Invitation: ${cfg.conference_name}` : "Conference invitation";
  const lines = filled.split("\n");
  if (lines.length > 0 && lines[0].toLowerCase().startsWith("subject:")) {
    subject = lines[0].slice(lines[0].indexOf(":") + 1).trim();
    filled = lines.slice(1).join("\n").replace(/^\n+/, "");
  }

  return { subject, body: filled };
}
