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
scheduler that silently never fires.

### If you still want a Vercel URL

Vercel can serve the **pages** — they are client components that hold no state.
What it cannot serve is `/api/*`. So the only arrangement that works is: the app
runs on EC2 as below, and a Vercel deployment proxies every API call to it, via
a `beforeFiles` rewrite in `next.config.ts` pointing at the instance.

Read this before you do it. That rewrite is made by Vercel's server, from
addresses that are not fixed on the Hobby plan, so **the EC2 API has to be open
to the internet** — and this app has no authentication at all. Any stranger who
finds the address can `POST /campaigns` with `dry_run: false` and send live mail
to your entire recipient list from your Gmail account. Making that safe means
adding real login, not a header check, because the browser is the caller and
cannot hold a secret.

For a tool one person uses, Vercel buys a public URL and a CDN in front of five
pages. It is not worth building authentication for. Put the whole app on EC2 and
reach it by SSH tunnel, or by nginx with a password — both below.

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

### Reaching it

The container listens on 3000. **Do not open port 3000 in the security group.**
The API has no authentication, so anything that can reach it can send live mail
from your Gmail to your whole list. Two safe options.

**Option 1 — SSH tunnel. Nothing exposed, nothing to configure.** Leave the
security group at SSH-only (ideally from your IP alone) and forward the port:

```bash
ssh -L 3000:localhost:3000 ec2-user@<instance>
```

Then open <http://localhost:3000>. This is the right choice for a tool you use
yourself.

**Option 2 — a password-protected HTTPS URL.** See
[Putting it on a public URL](#putting-it-on-a-public-url) for the full walkthrough;
the nginx config itself is here.

```bash
sudo dnf install -y nginx httpd-tools           # Amazon Linux 2023
sudo htpasswd -c /etc/nginx/.htpasswd you       # prompts for a password
```

`/etc/nginx/conf.d/research-automation.conf`:

```nginx
server {
    listen 80;
    server_name your.domain;

    location / {
        auth_basic           "Research Outreach";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # A batch runs for a long time; don't let the proxy cut it off.
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl enable --now nginx
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain            # adds TLS and the 80->443 redirect
```

Basic auth over plain HTTP sends the password in near-clear, so run certbot
before you use it from anywhere but home.

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

## Putting it on a public URL

You need a **domain you own**. Let's Encrypt refuses by policy to issue for
`*.compute.amazonaws.com`, so the hostname EC2 hands you cannot have a
certificate — point your own domain at the instance instead. Any registrar is
fine; this costs about $10 a year.

Never skip the password step. This app can send mail from your Gmail to thousands
of people and has no login of its own, so the only thing between a stranger and
your outbox is what you put in front of it.

**1. Give the instance a fixed address.** Allocate an Elastic IP and associate it
with the instance. Without one the public IP changes every time the instance
stops, and DNS silently points at nothing.

**2. Security group.** Inbound:

| Port | Source | Why |
| --- | --- | --- |
| 80 | `0.0.0.0/0` | certbot's HTTP challenge, and the redirect to 443 |
| 443 | `0.0.0.0/0` | the site |
| 22 | your IP only | admin |

**Port 3000 must not appear in that list.** It is the unauthenticated app; nginx
reaches it over localhost, nobody else needs to.

**3. DNS.** An `A` record for the name you want — `outreach.your-domain.com` —
pointing at the Elastic IP. Check it resolves before continuing, because certbot
fails confusingly if it doesn't:

```bash
dig +short outreach.your-domain.com     # must print the Elastic IP
```

**4. nginx with a password.**

```bash
sudo dnf install -y nginx httpd-tools              # Amazon Linux 2023
sudo htpasswd -c /etc/nginx/.htpasswd you          # prompts for a password
```

Write the server block from [Reaching it](#reaching-it) to
`/etc/nginx/conf.d/research-automation.conf`, with `server_name` set to your
domain, then:

```bash
sudo nginx -t && sudo systemctl enable --now nginx
```

**5. TLS.** certbot edits the config in place to add the certificate and the
80→443 redirect:

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d outreach.your-domain.com
sudo certbot renew --dry-run                       # confirms auto-renewal works
```

The package installs a renewal timer, so this does not need revisiting. Open
<https://outreach.your-domain.com>, enter the password, and you have the app.

### Without a domain

If you would rather not buy one, use a tunnel instead of opening ports at all.
[Tailscale](https://tailscale.com) gives the instance an HTTPS name on its
`ts.net` domain with no inbound ports and no Elastic IP:

- `tailscale serve https / http://127.0.0.1:3000` — reachable from your own
  devices anywhere, authenticated by Tailscale identity. Better security than a
  password on an open port, and the right choice if only you use this.
- `tailscale funnel 443 on` — same URL, but open to the whole internet. If you
  do that, still put the nginx basic-auth in front of it.

## Getting recipients onto the server

The database is deliberately not in the repo, so a fresh deployment has none.
Two ways, and the first is usually the right one:

**Paste them in.** Open **Recipients**, create a collection, and add addresses —
one at a time or a comma-separated blob. Nothing else is required. For
conference announcements this is generally all you want: you send to a list you
chose, and the 7,499 scraped author addresses never need to leave your laptop.

**Or upload the local database.** If you do want the scraped pool on the server,
copy it into the volume once. Stop the app first so the file isn't copied
mid-write, and checkpoint the WAL so the copy is complete rather than missing the
newest rows:

```bash
# on your laptop
sqlite3 data/app.db 'PRAGMA wal_checkpoint(TRUNCATE);'
scp data/app.db ec2-user@<instance>:/tmp/app.db

# on the instance
cd research-automation
docker compose stop app
docker compose run --rm -v /tmp/app.db:/tmp/app.db app cp /tmp/app.db /data/app.db
docker compose start app
rm /tmp/app.db                       # don't leave the address book in /tmp
```

Copy only `app.db`; SQLite rebuilds the `-wal` and `-shm` siblings. Bear in mind
this puts 7,499 real researchers' addresses on an internet-facing machine —
reason enough to prefer pasting in only the lists you actually need.

## After deploying

- Open **Email prompt** and fill in the conference and sender fields. They ship
  as visible `[SET …]`-style placeholders so an unedited template cannot be sent
  by accident.
- Leave a batch on **dry run** first and read the generated emails on the batch
  detail page before switching to live.
- The dashboard banner lists whatever environment variable is still missing.
