import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateQueries, buildUserPrompt } from "@/lib/openrouter";
import { QUERIES_PER_EMAIL } from "@/lib/models";
import { renderEmail, authorFirstName } from "@/lib/render";
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
 * the model for real queries; otherwise placeholders stand in and nothing is
 * spent.
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
              WHERE length(trim(abstract)) > 0 AND emails <> '[]'
              ORDER BY RANDOM() LIMIT 1`,
          )
          .get()
  ) as PaperRow | undefined;

  if (!paper) return NextResponse.json({ error: "No papers imported yet." }, { status: 400 });

  const authors: string[] = safeParse(paper.authors);
  const emails: string[] = safeParse(paper.emails);
  const recipient = emails[0] ?? "";

  let topic = "";
  let queries: string[] = [];
  let greeting = "";
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
      const gen = await generateQueries(apiKey, cfg, {
        title: paper.title,
        abstract: paper.abstract,
        authors,
        recipient,
      });
      topic = gen.topic;
      queries = gen.queries;
      greeting = gen.name || authorFirstName(authors);
    } catch (err) {
      modelError = String((err as Error)?.message ?? err);
    }
  }

  if (!body.live || modelError) {
    topic = topic || "[topic from the model]";
    greeting = greeting || authorFirstName(authors);
    queries =
      queries.length > 0
        ? queries
        : Array.from({ length: QUERIES_PER_EMAIL }, (_, i) => `[research query ${i + 1}]`);
  }

  const { subject, body: emailBody } = renderEmail(cfg, paper.title, greeting, topic, queries);

  return NextResponse.json({
    paper: {
      id: paper.id,
      title: paper.title,
      track: paper.track,
      authors,
      recipient,
      abstract: paper.abstract.slice(0, 400),
    },
    resolvedUserPrompt: buildUserPrompt(cfg, {
      title: paper.title,
      abstract: paper.abstract,
      authors,
      recipient,
    }),
    topic,
    queries,
    greeting,
    subject,
    body: emailBody,
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
