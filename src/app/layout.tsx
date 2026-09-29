import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Research Outreach",
  description: "Email automation and analytics for scraped OpenReview paper authors",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <Nav />
          <main className="mx-auto max-w-[1180px] px-5 py-7">{children}</main>
        </div>
      </body>
    </html>
  );
}
