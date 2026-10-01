import { randomUUID } from "node:crypto";
import { db, getSetting, setSetting } from "./db";

/**
 * Email tracking: a 1x1 pixel for opens and rewritten links for clicks, both
 * keyed by a per-send `track_id` that attributes events back to one row of
 * `sends`.
 *
 * Honest about the limits: Apple Mail privacy proxies prefetch images, so
 * opens overcount, and text-only clients never render the HTML part at all.
 * Clicks are the trustworthy signal — they only happen on a real user action.
 */

/** The 1x1 transparent GIF — 43 bytes, the smallest image that renders. */
export const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export const TRACKING_ENABLED_KEY = "tracking_enabled";
export const TRACKING_BASE_URL_KEY = "tracking_base_url";

export function trackingEnabled(): boolean {
  return getSetting(TRACKING_ENABLED_KEY, "1") === "1";
}

export function setTrackingEnabled(enabled: boolean) {
  setSetting(TRACKING_ENABLED_KEY, enabled ? "1" : "0");
}

/**
 * Where recipients are pointed for /api/track/* — must be a URL reachable
 * from their mail client, so localhost only works while testing sends to
 * yourself. `APP_BASE_URL` seeds it once; after that the setting wins.
 */
export function trackingBaseUrl(): string {
  const stored = getSetting(TRACKING_BASE_URL_KEY, "").trim();
  if (stored) return stored.replace(/\/+$/, "");
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function setTrackingBaseUrl(url: string) {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) setSetting(TRACKING_BASE_URL_KEY, clean);
}

export function newTrackId(): string {
  return randomUUID();
}

/**
 * Turn the plain-text draft into a minimal HTML email. Kept deliberately
 * simple — escaped text, paragraphs on blank lines, URLs auto-linked — since
 * every mail client mangles rich HTML anyway.
 */
export function textToHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s<)"']+)/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  return `<div style="font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a;">${linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin: 0 0 12px 0;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

/**
 * Inject the tracking artifacts: every http(s) link becomes a redirect through
 * /api/track/click, and one invisible pixel is placed near the top AND the
 * bottom (dual placement — some clients block the first image but load the
 * last one). The `p` parameter distinguishes the two fetches in the log.
 */
export function addTracking(html: string, baseUrl: string, trackId: string): string {
  const tracked = html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (match, url: string) => {
      // Never wrap a link that already points back at the tracker.
      if (url.startsWith(`${baseUrl}/api/track/`)) return match;
      return `href="${baseUrl}/api/track/click?id=${trackId}&url=${encodeURIComponent(url)}"`;
    },
  );
  const pixel = (position: "top" | "bottom") =>
    `<img src="${baseUrl}/api/track/open?id=${trackId}&p=${position}" width="1" height="1" alt="" style="display:block;height:1px;width:1px;overflow:hidden;border:0;" />`;
  return `${pixel("top")}${tracked}${pixel("bottom")}`;
}

/**
 * The HTML part for a send: converted text plus tracking, or plain HTML with
 * no artifacts when tracking is off (a deliberate, per-install choice — see
 * the consent note on the dashboard card).
 */
export function buildHtmlPart(
  body: string,
  trackId: string,
  imageCid?: string,
): { html: string; tracked: boolean } {
  let html = textToHtml(body);
  if (imageCid) html += imageHtml(imageCid);
  if (!trackingEnabled()) return { html, tracked: false };
  return { html: addTracking(html, trackingBaseUrl(), trackId), tracked: true };
}

/**
 * The configuration's image, below the text. `max-width:100%` keeps it inside
 * a phone's viewport; `height:auto` stops Outlook stretching it.
 */
export function imageHtml(cid: string): string {
  return `<div style="margin-top:16px;"><img src="cid:${cid}" alt="" style="display:block;max-width:100%;height:auto;border:0;" /></div>`;
}

/** Stable per-message, and distinct from anything a body might contain. */
export const IMAGE_CID = "ra-prompt-image";
