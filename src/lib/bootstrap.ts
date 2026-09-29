import { db } from "./db";
import { startScheduler } from "./scheduler";

/**
 * Server-side startup, run once per process as a side effect of the first API
 * route that imports it.
 *
 * This deliberately does NOT live in `instrumentation.ts`: Next compiles that
 * file for the edge runtime as well as Node, and the edge bundler cannot
 * resolve better-sqlite3's `fs` dependency — a `NEXT_RUNTIME` check inside
 * `register()` runs far too late to prevent that. API routes are Node-only, so
 * importing here keeps the native module off the edge graph entirely.
 */
const g = globalThis as unknown as { __raBootstrapped?: boolean };

if (!g.__raBootstrapped) {
  g.__raBootstrapped = true;

  // A campaign left 'running' by a crash or restart is no longer running —
  // mark it paused so it can be resumed deliberately.
  db.prepare("UPDATE campaigns SET status = 'paused' WHERE status = 'running'").run();

  startScheduler();
}

export {};
