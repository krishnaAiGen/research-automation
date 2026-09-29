# Deploying

This app needs **a writable disk and a process that stays alive**. That rules
out serverless hosts, Vercel included. It runs unchanged on any host that gives
it those two things.

## Why not Vercel

Three separate blockers, not one:

| What the app does | What Vercel gives it |
| --- | --- |
| Opens `data/app.db` with better-sqlite3, creating the directory if missing | A read-only filesystem outside `/tmp`, so `fs.mkdirSync` throws `EROFS` before any request is served — this is the 500 behind every API route |
| Ships no database in the repo (`data/*.db` is gitignored, and rightly so — it holds real people's addresses) | Nothing to read even if the disk were writable |
| Runs the scheduler on a 30-second `setInterval`, and keeps batch pause/resume state in an in-memory `Map` | Functions that freeze between requests. Vercel Cron on Hobby fires **once per day with ±59 minutes of jitter**, so a drip schedule cannot exist; a batch of 50 sends at 3 s apart also outlives the function timeout |

Fixing only the storage layer would give you a dashboard that loads and a
scheduler that silently never fires. If you must stay on Vercel, the real work
is: port every query to a hosted Postgres, replace the scheduler with Vercel
Cron on a Pro plan, and move run state into the database.

## Recommended: Render, Railway, Fly, or any VPS

No code changes and no Dockerfile — these build straight from the repo.

1. **Create a web service** from this GitHub repo.
   - Build command: `npm ci && npm run build`
   - Start command: `npm start`
   - `npm start` listens on `$PORT`, which the platform sets. Don't hardcode a port.
2. **Attach a persistent disk** and mount it at `/data`.
   1 GB is ample; the database is about 17 MB with ~6,000 papers.
3. **Set the environment variables:**

   | Variable | Value |
   | --- | --- |
   | `DATABASE_PATH` | `/data/app.db` — must point at the mounted disk, or the database dies with the container |
   | `OPENROUTER_API_KEY` | Required for any send, dry runs included |
   | `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` | Required for live delivery. Without them only dry runs work |
   | `GMAIL_FROM_NAME` | Optional display name |

   `SCRAPER_ROOT` is only read by `npm run import`, so it isn't needed on the server.

4. **Deploy.** It comes up with an empty database and creates its own schema,
   the default prompt configuration, and an empty first collection. Every page
   loads; the dashboard just shows zeros. Verified — nothing needs seeding for
   the app to start.

## Getting recipients onto the server

The database is deliberately not in the repo, so a fresh deployment has none.
Two ways, and the first is usually the right one:

**Paste them in.** Open **Recipients**, create a collection, and add addresses —
one at a time or a comma-separated blob. Nothing else is required. For
conference announcements this is generally all you want: you send to a list you
chose, and the 7,499 scraped author addresses never need to leave your laptop.

**Or upload the local database.** If you do want the scraped pool, copy it to
the disk once, with the app stopped so the copy isn't mid-write:

```bash
npm run reset            # optional: makes a timestamped backup first
# then, per platform:
fly sftp shell           # Fly
railway run bash         # Railway
# Render: use the service's Shell tab
```

Copy `data/app.db` to `/data/app.db`. Leave the `-wal` and `-shm` files behind;
SQLite rebuilds them. Bear in mind this puts 7,499 real researchers' addresses
on a server — reason enough to prefer pasting in only the lists you need.

## After deploying

- Open **Email prompt** and fill in the conference and sender fields. They ship
  as visible `[SET …]`-style placeholders so an unedited template cannot be sent
  by accident.
- Leave a batch on **dry run** first and read the generated emails on the batch
  detail page before switching to live.
- The dashboard banner lists whatever environment variable is still missing.
