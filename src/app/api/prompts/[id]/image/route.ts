import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteImageIfUnused, imageError, saveImage } from "@/lib/images";
import type { PromptConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function config(id: number): PromptConfig | undefined {
  return db.prepare("SELECT * FROM prompt_configs WHERE id = ?").get(id) as
    | PromptConfig
    | undefined;
}

/** How many configurations still point at a file, so cleanup is safe. */
function referenceCount(file: string, excludingId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM prompt_configs WHERE image_file = ? AND id != ?")
    .get(file, excludingId) as { n: number };
  return row.n;
}

export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const existing = config(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image was uploaded." }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const problem = imageError(file.type, data.length);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const stored = saveImage(data, file.type, file.name);

  db.prepare(
    "UPDATE prompt_configs SET image_file = ?, image_mime = ?, image_name = ?, updated_at = ? WHERE id = ?",
  ).run(stored.file, stored.mime, stored.name, new Date().toISOString(), id);

  // The previous image may now be orphaned.
  if (existing.image_file && existing.image_file !== stored.file) {
    deleteImageIfUnused(existing.image_file, referenceCount(existing.image_file, id));
  }

  return NextResponse.json({ config: config(id), bytes: stored.bytes });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const existing = config(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare(
    "UPDATE prompt_configs SET image_file = '', image_mime = '', image_name = '', updated_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), id);

  if (existing.image_file) {
    deleteImageIfUnused(existing.image_file, referenceCount(existing.image_file, id));
  }
  return NextResponse.json({ config: config(id) });
}
