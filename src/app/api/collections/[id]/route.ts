import { NextResponse } from "next/server";
import { deleteCollection, getCollection, renameCollection } from "@/lib/collections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!getCollection(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body.name === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const name = String(body.name).trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  return NextResponse.json({ collection: renameCollection(id, name) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const res = deleteCollection(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
