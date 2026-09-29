"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Analytics" },
  { href: "/prompt", label: "Email prompt" },
  { href: "/campaigns", label: "Send" },
  { href: "/schedule", label: "Schedule" },
  { href: "/recipients", label: "Recipients" },
];

export default function Nav() {
  const pathname = usePathname();
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
      </div>
    </header>
  );
}
