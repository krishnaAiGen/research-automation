/**
 * Session auth for the whole app.
 *
 * Deliberately dependency-free and edge-safe: this module is imported by
 * `src/middleware.ts`, which Next compiles for the edge runtime where node's
 * `crypto` does not exist. Everything here uses WebCrypto, which is available
 * both there and in the Node route handlers.
 *
 * Off unless AUTH_USERNAME and AUTH_PASSWORD are both set, so an existing
 * deployment or a local checkout keeps working untouched.
 */

/** Signed, HttpOnly. The only thing that grants access. */
export const SESSION_COOKIE = "ra_session";

/**
 * Readable by JavaScript and trusted for nothing — it exists so the header can
 * show who is signed in. Never consulted when deciding whether to allow a
 * request.
 */
export const DISPLAY_COOKIE = "ra_user";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

export function authEnabled(): boolean {
  return Boolean(username() && password());
}

function username(): string {
  return (process.env.AUTH_USERNAME || "").trim();
}

function password(): string {
  return (process.env.AUTH_PASSWORD || "").trim();
}

/**
 * Comparison whose duration does not depend on where the first difference is,
 * so a wrong password cannot be narrowed down by timing the response.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function credentialsMatch(user: unknown, pass: unknown): boolean {
  if (!authEnabled()) return false;
  // Both compared always, never short-circuited, for the same timing reason.
  const okUser = safeEqual(String(user ?? ""), username());
  const okPass = safeEqual(String(pass ?? ""), password());
  return okUser && okPass;
}

/**
 * The HMAC key. Falls back to the password so there is one less thing to
 * configure — which also means changing the password invalidates every existing
 * session, that being the desirable behaviour. Set AUTH_SECRET to decouple them.
 */
async function signingKey(): Promise<CryptoKey | null> {
  const secret = (process.env.AUTH_SECRET || "").trim() || password();
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw",
    utf8(`ra:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Backed by an explicit ArrayBuffer: WebCrypto's BufferSource will not accept a
// Uint8Array that TypeScript types as possibly sharing a SharedArrayBuffer.
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Same reason as fromBase64Url: give WebCrypto an ArrayBuffer-backed view. */
function utf8(text: string): Uint8Array<ArrayBuffer> {
  const source = encoder.encode(text);
  const out = new Uint8Array(new ArrayBuffer(source.length));
  out.set(source);
  return out;
}

/** `<payload>.<hmac>`; the payload is readable but cannot be altered. */
export async function createSession(
  user: string,
  now: number,
  ttlMs = SESSION_TTL_MS,
): Promise<string> {
  const key = await signingKey();
  if (!key) throw new Error("Auth is not configured.");
  const payload = toBase64Url(utf8(JSON.stringify({ u: user, exp: now + ttlMs })));
  const mac = await crypto.subtle.sign("HMAC", key, utf8(payload));
  return `${payload}.${toBase64Url(new Uint8Array(mac))}`;
}

export async function readSession(
  token: string | undefined,
  now: number,
): Promise<{ username: string } | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const key = await signingKey();
  if (!key) return null;

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(mac),
      utf8(payload),
    );
  } catch {
    return null; // malformed base64 in the signature
  }
  if (!valid) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (typeof claims?.exp !== "number" || now > claims.exp) return null;
    return { username: String(claims.u ?? "") };
  } catch {
    return null;
  }
}

/**
 * `Secure` may only be set when the browser reached us over HTTPS, or the
 * cookie is silently dropped and the login appears to succeed and do nothing.
 * Behind Tailscale Funnel or nginx the original scheme arrives in a header.
 */
export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(req.url).protocol === "https:";
}
