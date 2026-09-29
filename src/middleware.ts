import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, readSession } from "@/lib/auth";

/**
 * Gate every page and API route behind a session.
 *
 * Runs before anything else, so a route can never be reached unauthenticated by
 * being forgotten here — which is the failure mode of checking inside each of
 * the thirteen handlers instead.
 */
export async function middleware(req: NextRequest) {
  // No credentials configured: behave exactly as the app did before.
  if (!authEnabled()) return NextResponse.next();

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value, Date.now());
  if (session) return NextResponse.next();

  // An API caller wants a status code it can render, not a login page.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  const target = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = target === "/" ? "" : `?next=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Everything except:
   *   _next/*      build output
   *   favicon.ico  requested before login and harmless
   *   login        the page you are sent to, which cannot require a session
   *   api/auth/*   signing in and out
   *   api/health   the container HEALTHCHECK calls this with no credentials;
   *                gating it would mark a perfectly healthy container unhealthy
   */
  matcher: ["/((?!_next/|favicon\\.ico|login|api/auth/|api/health).*)"],
};
