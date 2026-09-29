"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Field, Toast } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Only ever a path on this app, never an absolute URL — an attacker-supplied
  // `next` must not be able to bounce someone to another site after login.
  const raw = params.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not sign in.");
        setBusy(false);
        return;
      }
      // replace(), not push(), so Back does not return to the login form.
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[400px]">
      <Card title="Sign in" subtitle="This app can send email on your behalf.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <input
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {error && <Toast message={error} tone="error" />}

          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={busy || !username || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for the page to stay static.
  return (
    <Suspense fallback={<p style={{ color: "var(--text-muted)" }}>Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
