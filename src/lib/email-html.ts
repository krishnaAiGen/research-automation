/**
 * The HTML part for a send: the plain-text draft converted to minimal HTML,
 * plus the configuration's embedded image below the text. There is no tracking
 * here — no pixel, no link rewriting, no remote content — deliberately, since
 * remote-image fetches and rewritten links are spam-filter signals. The image
 * is embedded by Content-ID, so it renders without the recipient granting
 * remote-image permission and needs nothing of ours to be reachable.
 */

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
 * The configuration's image, below the text. `max-width:100%` keeps it inside
 * a phone's viewport; `height:auto` stops Outlook stretching it.
 */
export function imageHtml(cid: string): string {
  return `<div style="margin-top:16px;"><img src="cid:${cid}" alt="" style="display:block;max-width:100%;height:auto;border:0;" /></div>`;
}

/** Stable per-message, and distinct from anything a body might contain. */
export const IMAGE_CID = "ra-prompt-image";

export function buildHtmlPart(body: string, imageCid?: string): string {
  let html = textToHtml(body);
  if (imageCid) html += imageHtml(imageCid);
  return html;
}
