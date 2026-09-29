import { NextResponse } from "next/server";
import { db, defaultCollectionId } from "@/lib/db";
import { addRecipients, deleteRecipients, getCollection } from "@/lib/collections";

export const dynamic = "force-dynamic";

/** Browse one collection's addresses with their per-address send state. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "all"; // all | sent | pending
  const track = url.searchParams.get("track") || "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const collectionId =
    Number(url.searchParams.get("collection_id")) || defaultCollectionId();
  const perPage = 50;

  const where: string[] = ["r.collection_id = ?"];
  const params: unknown[] = [collectionId];

  if (q) {
    // Matches only what the table shows. The paper title was searchable here
    // once, which meant a hit could be a row with nothing visibly matching.
    where.push("(r.email LIKE ? OR r.name LIKE ? OR r.notes LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (track) {
    where.push("p.track = ?");
    params.push(track);
  }
  const sentExpr = `EXISTS (SELECT 1 FROM sends s WHERE lower(s.email) = lower(r.email) AND s.status = 'sent')`;
  if (status === "sent") where.push(sentExpr);
  if (status === "pending") where.push(`NOT ${sentExpr}`);

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM recipients r
           LEFT JOIN papers p ON p.id = r.paper_id ${whereSql}`,
      )
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT r.id, r.email, r.name, r.notes, r.position, r.source,
              r.paper_id, p.title, p.track,
              ${sentExpr} AS sent,
              (SELECT s.created_at FROM sends s
                WHERE lower(s.email) = lower(r.email) AND s.status = 'sent'
                ORDER BY s.created_at DESC LIMIT 1) AS sent_at
         FROM recipients r
         LEFT JOIN papers p ON p.id = r.paper_id
         ${whereSql}
        ORDER BY r.seq, r.id
        LIMIT ? OFFSET ?`,
    )
    .all(...params, perPage, (page - 1) * perPage);

  return NextResponse.json({
    rows,
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  });
}

/**
 * Add addresses to a collection. `emails` is one address or many separated by
 * commas (newlines and semicolons work too). Anything already in the
 * collection is reported as a duplicate rather than failing the whole paste.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const collectionId = Number(body.collection_id) || 0;
  if (!getCollection(collectionId)) {
    return NextResponse.json({ error: "Collection not found." }, { status: 400 });
  }

  const result = addRecipients(collectionId, String(body.emails ?? ""), {
    name: body.name,
    notes: body.notes,
  });

  if (result.added === 0 && result.duplicates.length === 0) {
    return NextResponse.json(
      {
        error:
          result.invalid.length > 0
            ? `No valid addresses found. Rejected: ${result.invalid.slice(0, 5).join(", ")}`
            : "No addresses provided.",
        ...result,
      },
      { status: 400 },
    );
  }

  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const collectionId = Number(body.collection_id) || 0;
  if (!getCollection(collectionId)) {
    return NextResponse.json({ error: "Collection not found." }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) return NextResponse.json({ error: "No rows selected." }, { status: 400 });

  return NextResponse.json({ removed: deleteRecipients(collectionId, ids) });
}
