# Deploying

This app needs **a writable disk and a process that stays alive**. That rules
out serverless hosts, Vercel included. Docker on an EC2 instance gives it both,
with no code changes — see [Docker on EC2](#docker-on-ec2).

Render, Railway, Fly or any VPS work the same way: build `npm ci && npm run
build`, start `npm start` (it honours `$PORT`), and mount a disk with
`DATABASE_PATH` pointing into it.

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

## The install-scripts warning

A build log line like this is **advisory, not a failure**:

```
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   better-sqlite3@11.10.0 (install: prebuild-install || node-gyp rebuild)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
```

npm 11 still runs those scripts and only prints the list. npm 12 is expected to
**block** unapproved ones — and both of these matter: better-sqlite3's builds the
native `.node` binding, and esbuild's fetches the binary `tsx` runs on, which
`npm run import` and `npm run reset` need. Blocked, the app would not start on
any host.

`package.json` therefore carries an explicit approval, so the warning is gone and
an npm 12 upgrade cannot break the install:

```json
"allowScripts": {
  "better-sqlite3": true,
  "esbuild": true
}
```

Add an entry the same way if you ever take on another dependency with an install
script. Anything not listed there is worth reading before you approve it — that
is the point of the mechanism.

## Docker on EC2

`Dockerfile` and `docker-compose.yml` are in the repo. The image was built and
run end to end: all pages and API routes 200, the scheduler starts exactly once,
data survives `docker restart`, and the container reports `healthy`.

On the instance, once, install Docker:

```bash
sudo dnf install -y docker            # Amazon Linux 2023 (apt-get on Ubuntu)
sudo systemctl enable --now docker
sudo usermod -aG docker $USER         # log out and back in for this to apply
```

Then:

```bash
git clone https://github.com/krishnaAiGen/research-automation.git
cd research-automation
cp .env.example .env.local            # fill in the keys; compose reads this file
docker compose up -d --build
curl localhost:3000/api/health
```

That's it. `restart: unless-stopped` brings it back after a crash or an instance
reboot, so a schedule resumes unattended; anything left mid-batch is marked
paused at startup and resumes from the Send page.

**Environment variables** go in `.env.local`:

| Variable | Value |
| --- | --- |
| `OPENROUTER_API_KEY` | Required for any send, dry runs included |
| `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` | Required for live delivery. Without them only dry runs work |
| `GMAIL_FROM_NAME` | Optional display name |

`DATABASE_PATH` is set to `/data/app.db` by compose — don't override it, or the
database lands on the container filesystem and is discarded on the next deploy.
`SCRAPER_ROOT` is only read by `npm run import` and isn't needed.

**The volume is the whole point.** Compose declares a named volume `app-data`
mounted at `/data`. It outlives the container, so `docker compose up --build`
after a `git pull` redeploys the code and keeps the data. `docker compose down`
keeps it too; only `docker compose down -v` destroys it.

**Reaching it.** The container listens on 3000. Don't open 3000 to the world —
the API has no authentication, so anyone who found it could start a live send
from your Gmail. Either keep the security group closed and use an SSH tunnel:

```bash
ssh -L 3000:localhost:3000 ec2-user@<instance>
# then open http://localhost:3000
```

…or put nginx or a load balancer in front with TLS and a password.

**Maintenance runs inside the container** — verified working, since the image
keeps the dev dependencies `tsx` needs:

```bash
docker compose exec app npm run reset       # clear send history, backup first
docker compose exec app npm run reset -- --prompts
docker compose logs -f app
```

Backups are just the volume:

```bash
docker compose exec app sh -c 'cd /data && tar cf - app.db' > backup-$(date +%F).tar
```

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
