import { NextResponse } from "next/server";
import { collectionSummaries, createCollection } from "@/lib/collections";
import { defaultCollectionId } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    collections: collectionSummaries(),
    defaultId: defaultCollectionId(),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  return NextResponse.json({ collection: createCollection(name) });
}
