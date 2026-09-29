import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateEmail, buildUserPrompt } from "@/lib/openrouter";
import { renderEmail, firstName } from "@/lib/render";
import type { PromptConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type PaperRow = {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  emails: string;
  track: string;
};

/**
 * Render one email from the config in the request body — which may be unsaved,
 * so the editor can preview edits before committing them. `live: true` calls
 * the model to draft the email; otherwise the template is rendered as-is so
 * nothing is spent.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = body.config as PromptConfig | undefined;
  if (!cfg) return NextResponse.json({ error: "Missing config" }, { status: 400 });

  const paper = (
    body.paper_id
      ? db
          .prepare(
            "SELECT id, title, abstract, authors, emails, track FROM papers WHERE id = ?",
          )
          .get(String(body.paper_id))
      : db
          .prepare(
            `SELECT id, title, abstract, authors, emails, track FROM papers
              WHERE emails <> '[]'
              ORDER BY RANDOM() LIMIT 1`,
          )
          .get()
  ) as PaperRow | undefined;

  if (!paper) return NextResponse.json({ error: "No papers imported yet." }, { status: 400 });

  const authors: string[] = safeParse(paper.authors);
  const emails: string[] = safeParse(paper.emails);
  const recipient = emails[0] ?? "";
  // The preview stands in for a real queue row: the first author plays the
  // recipient and the paper's track plays their research area.
  const ctx = {
    recipient,
    name: authors[0] ?? "",
    notes: paper.track,
  };

  let subject = "";
  let emailBody = "";
  let source: "model" | "template" = "template";
  let modelError: string | null = null;

  if (body.live) {
    const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY is not set in .env.local." },
        { status: 400 },
      );
    }
    try {
      const gen = await generateEmail(apiKey, cfg, ctx);
      subject = gen.subject;
      emailBody = gen.body;
      source = "model";
    } catch (err) {
      modelError = String((err as Error)?.message ?? err);
    }
  }

  if (source === "template") {
    const rendered = renderEmail(cfg, {
      email: recipient,
      name: ctx.name,
      researchArea: ctx.notes,
    });
    subject = rendered.subject;
    emailBody = rendered.body;
  }

  return NextResponse.json({
    paper: {
      id: paper.id,
      title: paper.title,
      track: paper.track,
      authors,
      recipient,
      abstract: paper.abstract.slice(0, 400),
    },
    resolvedUserPrompt: buildUserPrompt(cfg, ctx),
    greeting: firstName(ctx.name),
    subject,
    body: emailBody,
    source,
    modelError,
  });
}

function safeParse(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
