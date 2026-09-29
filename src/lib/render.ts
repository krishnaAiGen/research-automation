import type { PromptConfig } from "./types";

export type RenderedEmail = { subject: string; body: string };

/**
 * Fill the template placeholders. Mirrors the Python renderer exactly:
 *   {topic} {First Name} {Paper Title} {query 1..N}
 *   {product link: ...} / {demo link: ...}  -> configured URLs
 * A leading "Subject: ..." line sets the subject and is stripped from the body.
 */
export function renderEmail(
  cfg: PromptConfig,
  title: string,
  firstName: string,
  topic: string,
  queries: string[],
): RenderedEmail {
  const topicText = topic || title;
  let filled = cfg.template
    .replaceAll("{topic}", topicText)
    .replaceAll("{First Name}", firstName || "there")
    .replaceAll("{Paper Title}", title);

  queries.forEach((q, i) => {
    filled = filled.replaceAll(`{query ${i + 1}}`, q);
  });

  filled = filled.replace(/\{product link:[^}]*\}/g, cfg.product_url);
  filled = filled.replace(/\{demo link:[^}]*\}/g, cfg.demo_url);

  // Drop leftover {query N} lines when the model returned fewer than N.
  filled = filled
    .split("\n")
    .filter((line) => !/\{query \d+\}/.test(line))
    .join("\n");

  let subject = `Impressed by your paper on ${topicText}`;
  const lines = filled.split("\n");
  if (lines.length > 0 && lines[0].toLowerCase().startsWith("subject:")) {
    subject = lines[0].slice(lines[0].indexOf(":") + 1).trim();
    filled = lines.slice(1).join("\n").replace(/^\n+/, "");
  }

  return { subject, body: filled };
}

export function authorFirstName(authors: string[]): string {
  const first = authors[0]?.trim();
  if (!first) return "there";
  return first.split(/\s+/)[0] || "there";
}
