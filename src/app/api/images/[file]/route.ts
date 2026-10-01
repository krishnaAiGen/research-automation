import { NextResponse } from "next/server";
import { mimeFor, readImage } from "@/lib/images";

export const dynamic = "force-dynamic";

/**
 * Serves an uploaded image for the preview in the UI. Emails do not use this
 * route — they carry the image as a CID attachment, so it renders even in
 * clients that block remote images, and does not depend on this instance
 * being reachable from the recipient's network.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // readImage rejects anything that is not a hash-shaped name it wrote itself.
  const data = readImage(file);
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": mimeFor(file),
      // The name is a content hash, so the bytes behind it never change.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(data.length),
    },
  });
}
