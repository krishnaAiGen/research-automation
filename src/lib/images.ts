import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { UPLOADS_DIR } from "./db";

/**
 * Images attached to a prompt configuration — a logo, a conference banner —
 * embedded in the HTML part of every email that configuration sends.
 *
 * Stored beside the database rather than in it: the same directory means the
 * same Docker volume, so an upload survives `docker compose up --build` with
 * no extra configuration, and a 200 KB banner never bloats every SELECT.
 */

/** Formats every mail client renders. SVG is excluded deliberately: it can carry script. */
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Attachments ride along with every single message, so a 5 MB banner on a
 * 1,000-address batch is 5 GB over SMTP and a near-certain spam flag.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type StoredImage = { file: string; mime: string; name: string; bytes: number };

export function uploadsDir(): string {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

export function imageError(mime: string, bytes: number): string | null {
  if (!ALLOWED[mime]) {
    return `${mime || "That file type"} is not supported. Use PNG, JPEG, GIF or WebP.`;
  }
  if (bytes > MAX_IMAGE_BYTES) {
    return `Image is ${(bytes / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB, because it is attached to every message in the batch.`;
  }
  if (bytes === 0) return "That file is empty.";
  return null;
}

/**
 * The stored filename is derived from the content hash, never from what the
 * browser sent — an uploaded name is attacker-controlled and the obvious route
 * to writing outside this directory.
 */
export function saveImage(data: Buffer, mime: string, originalName: string): StoredImage {
  const ext = ALLOWED[mime];
  if (!ext) throw new Error("Unsupported image type.");
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 32);
  const file = `${hash}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir(), file), data);
  return {
    file,
    mime,
    // Kept only to show in the UI; never used to build a path.
    name: path.basename(originalName).slice(0, 120) || `image.${ext}`,
    bytes: data.length,
  };
}

/** Resolve a stored name to a path, refusing anything that escapes the directory. */
export function imagePath(file: string): string | null {
  if (!file || !/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(file)) return null;
  const full = path.join(uploadsDir(), file);
  if (!full.startsWith(uploadsDir() + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

export function readImage(file: string): Buffer | null {
  const full = imagePath(file);
  return full ? fs.readFileSync(full) : null;
}

/**
 * Delete only when no configuration still points at it — the same upload is
 * shared by every config that happens to have identical bytes.
 */
export function deleteImageIfUnused(file: string, stillReferenced: number): void {
  if (stillReferenced > 0) return;
  const full = imagePath(file);
  if (full) fs.rmSync(full, { force: true });
}

export function mimeFor(file: string): string {
  const ext = file.split(".").pop() ?? "";
  return Object.entries(ALLOWED).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
}
