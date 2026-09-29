"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DISPLAY_COOKIE } from "@/lib/auth";

const LINKS = [
  { href: "/", label: "Analytics" },
  { href: "/prompt", label: "Email prompt" },
  { href: "/campaigns", label: "Send" },
  { href: "/schedule", label: "Schedule" },
  { href: "/recipients", label: "Recipients" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);

  // Read the display cookie, which exists only to answer "who is signed in".
  // Access is decided by the signed HttpOnly cookie the browser cannot see.
  useEffect(() => {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${DISPLAY_COOKIE}=([^;]*)`),
    );
    setUser(match ? decodeURIComponent(match[1]) : null);
  }, [pathname]);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.replace("/login");
    router.refresh();
  };

  // The login page gets a bare header: the links behind it all require a session.
  if (pathname === "/login") {
    return (
      <header
        className="border-b"
        style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
      >
        <div className="mx-auto max-w-[1180px] px-5 py-3">
          <span className="text-[0.95rem] font-semibold tracking-tight">Research Outreach</span>
        </div>
      </header>
    );
  }

  return (
    <header
      className="sticky top-0 z-20 border-b"
      style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
    >
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <Link href="/" className="text-[0.95rem] font-semibold tracking-tight">
          Research Outreach
        </Link>
        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-2.5 py-1.5 text-sm"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  background: active ? "var(--plane)" : "transparent",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {user}
            </span>
            <button className="btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
