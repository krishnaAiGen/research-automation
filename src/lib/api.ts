/**
 * Fetch JSON from one of this app's API routes.
 *
 * Every page used to do `fetch(url).then(r => r.json())`, which has one bad
 * failure mode: when a route 500s, the body is an HTML error page, `r.json()`
 * throws "Unexpected token '<'", the rejection is never caught, and the state
 * the page renders on stays null — so the page shows its loading text forever
 * with nothing anywhere saying what broke. This throws an Error carrying the
 * status and whatever detail the response held, for the caller to surface.
 */
export async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Offline, DNS, CORS, aborted — fetch itself rejected.
    throw new Error(`Could not reach ${url}: ${(err as Error)?.message ?? err}`);
  }

  // Read once: a body can only be consumed a single time, so trying json()
  // first and falling back to text() would fail on the fallback.
  const raw = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}${detailOf(raw)}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${url} returned ${res.status} but the body was not JSON${detailOf(raw)}`);
  }
}

/** The server's own `{ error }` when there is one, else a short excerpt. */
function detailOf(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
      return ` — ${parsed.error}`;
    }
  } catch {
    /* not JSON: fall through to the excerpt */
  }
  // An HTML error page is noise; say so rather than pasting markup.
  if (/^\s*<(!doctype|html)/i.test(raw)) return " — the server returned an HTML error page";
  return ` — ${raw.slice(0, 200)}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
