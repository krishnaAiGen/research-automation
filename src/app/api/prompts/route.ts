import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/models";
import {
  db,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT,
  DEFAULT_TEMPLATE,
  CONTACT_SYSTEM_PROMPT,
  CONTACT_USER_PROMPT,
  CONTACT_TEMPLATE,
} from "@/lib/db";
import type { PromptConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const configs = db
    .prepare("SELECT * FROM prompt_configs ORDER BY is_active DESC, id DESC")
    .all() as PromptConfig[];
  return NextResponse.json({ configs });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  // `preset: "contact"` starts from the hand-built-list prompts rather than
  // copying whatever the editor currently has open, which is paper-shaped.
  const contact = body.preset === "contact";
  const base = contact
    ? {
        name: "Hand-built list (starter)",
        system_prompt: CONTACT_SYSTEM_PROMPT,
        user_prompt: CONTACT_USER_PROMPT,
        template: CONTACT_TEMPLATE,
      }
    : {
        name: "Untitled prompt",
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        user_prompt: DEFAULT_USER_PROMPT,
        template: DEFAULT_TEMPLATE,
      };

  const info = db
    .prepare(
      `INSERT INTO prompt_configs
        (name, is_active, model, reasoning, system_prompt, user_prompt,
         template, product_url, demo_url, created_at, updated_at)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(body.name || base.name),
      String(body.model || DEFAULT_MODEL),
      body.reasoning ? 1 : 0,
      String(contact ? base.system_prompt : (body.system_prompt ?? base.system_prompt)),
      String(contact ? base.user_prompt : (body.user_prompt ?? base.user_prompt)),
      String(contact ? base.template : (body.template ?? base.template)),
      String(body.product_url ?? ""),
      String(body.demo_url ?? ""),
      now,
      now,
    );
  const config = db
    .prepare("SELECT * FROM prompt_configs WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as PromptConfig;
  return NextResponse.json({ config });
}
