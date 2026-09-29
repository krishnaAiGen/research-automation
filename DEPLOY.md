# Deploying

This app needs **a writable disk and a process that stays alive**. That rules
out serverless hosts, Vercel included. Docker on an EC2 instance gives it both,
with no code changes.

Render, Railway, Fly or any VPS work the same way: build `npm ci && npm run
build`, start `npm start` (it honours `$PORT`), and mount a disk with
`DATABASE_PATH` pointing into it.

**Start here:** [EC2 from scratch](#ec2-from-scratch) is the complete walkthrough —
launch an instance, run the app in Docker, and reach it on a free HTTPS hostname
with no domain to buy and no ports to open.

## EC2 from scratch

Every step, in order. Budget about twenty minutes, most of it waiting on the
image build.

### 1. Launch the instance

In the EC2 console, **Launch instance**:

| Setting | Value | Why |
| --- | --- | --- |
| AMI | Amazon Linux 2023 | The `dnf` commands below assume it |
| Instance type | **t3.small** (2 GiB) | `next build` runs on the instance and will OOM on t3.micro's 1 GiB unless you add swap — see [If the build is killed](#if-the-build-is-killed) |
| Key pair | create or pick one | You need it to SSH in |
| Storage | **20 GiB gp3** | The default 8 GiB is too tight: the image alone is ~1.2 GiB before build cache |
| Security group | **SSH (22) from My IP** and nothing else | Tailscale needs no inbound port at all |

Leave outbound rules at the default (allow all) — the app needs to reach
OpenRouter and Gmail. AWS throttles outbound port 25, but this app sends over
465, so that restriction doesn't apply.

Then connect:

```bash
ssh -i /path/to/key.pem ec2-user@<instance-public-ip>
```

### 2. Install Docker and the compose plugin

```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

`dnf install docker` on Amazon Linux 2023 does **not** include `docker compose`,
so install the plugin explicitly or every compose command below fails with
"docker: 'compose' is not a docker command":

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

On an ARM instance (`t4g.*`) use the `aarch64` binary instead.

Now log out and back in so the `docker` group applies, then check both:

```bash
exit
ssh -i /path/to/key.pem ec2-user@<instance-public-ip>
docker ps && docker compose version
```

### 3. Run the app

```bash
git clone https://github.com/krishnaAiGen/research-automation.git
cd research-automation
cp .env.example .env.local
nano .env.local          # fill in the keys below, then Ctrl-O, Enter, Ctrl-X
```

| Variable | Needed for |
| --- | --- |
| `OPENROUTER_API_KEY` | Any send at all, dry runs included |
| `GMAIL_ADDRESS` | Live delivery |
| `GMAIL_APP_PASSWORD` | Live delivery — a Google [App Password](https://myaccount.google.com/apppasswords), not your login password |
| `GMAIL_FROM_NAME` | Optional display name |

Leave `DATABASE_PATH` and `SCRAPER_ROOT` alone; compose sets the first and the
second is only for `npm run import`.

```bash
docker compose up -d --build     # first build takes a few minutes
curl localhost:3004/api/health
```

A JSON response means it's up. `"dataImported":false` is expected — the database
starts empty and seeds its own schema.

### 4. Get a free HTTPS hostname

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

That prints a URL. Open it in your browser and sign in; the instance joins your
tailnet. Then in the [admin console](https://login.tailscale.com/admin/dns)
under **DNS**, enable **MagicDNS** and **HTTPS Certificates** — `serve` cannot
issue a certificate without them.

```bash
sudo tailscale serve --bg 3004
sudo tailscale serve status        # prints your https://<host>.<tailnet>.ts.net URL
```

### 5. Open it

**Install Tailscale on the machine you want to browse from** and sign into the
same account. This is the step people miss: `serve` publishes to your tailnet, so
without the client the URL will not resolve.

Then open the `https://<host>.<tailnet>.ts.net` URL from your laptop or phone,
anywhere in the world. Real certificate, no warnings, nothing exposed to the
internet.

### 6. Configure the app

1. **Email prompt** — fill in the conference and sender fields. They ship as
   visible `[SET …]` placeholders so an unedited template can't go out by
   accident.
2. **Recipients** — create a collection and paste your addresses in, comma
   separated.
3. **Send** — leave **dry run** on for the first batch, then read the generated
   emails on the batch detail page before you switch to live.

### Day-to-day

```bash
cd research-automation
git pull && docker compose up -d --build    # deploy new code, data survives
docker compose logs -f app                  # follow logs
docker compose restart app                  # restart
docker compose exec app npm run reset       # clear send history (backs up first)
```

### If the build is killed

`next build` exiting with code 137 or "Killed" on a 1 GiB instance is the OOM
killer. Either resize to t3.small, or add swap:

```bash
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
```

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

## Container reference

Setup steps are in [EC2 from scratch](#ec2-from-scratch); this is what the
container does, for when something surprises you.

`Dockerfile` and `docker-compose.yml` are in the repo. The image was built and
run end to end before being committed: all pages and API routes 200, running as
the unprivileged `node` user, the scheduler starting exactly once, data surviving
`docker restart`, and the container reporting `healthy`.

**The volume is the whole point.** Compose declares a named volume `app-data`
mounted at `/data`, and `DATABASE_PATH=/data/app.db` points the app into it. It
outlives the container, so `docker compose up --build` after a `git pull`
redeploys code and keeps data. `docker compose down` keeps it too; only
`docker compose down -v` destroys it. Don't override `DATABASE_PATH`, or the
database lands on the container filesystem and is discarded on the next deploy.

**It restarts itself.** `restart: unless-stopped` brings the app back after a
crash or an instance reboot, so a schedule resumes unattended. A batch left
mid-run is marked `paused` at startup and resumes from the Send page — the
queue query means it picks up exactly where it stopped.

**One replica, deliberately.** "Nobody is emailed twice" is a `NOT EXISTS` check
against the `sends` table, which two containers could both pass for the same
address. Don't scale this service while it is backed by SQLite.

### Reaching it

The app is published on host port **3004**. **Do not open it in the security group.**
The API has no authentication, so anything that can reach it can send live mail
from your Gmail to your whole list.

The walkthrough uses Tailscale, which needs no open port at all. Two alternatives:

**An SSH tunnel** needs nothing installed. Leave the security group at SSH-only
and forward the port:

```bash
ssh -L 3004:localhost:3004 ec2-user@<instance>
```

Then open <http://localhost:3004>.

**nginx with a password**, if you have a domain — see
[Putting it on a public URL](#putting-it-on-a-public-url) for the full sequence.
The server block itself:

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

        proxy_pass         http://127.0.0.1:3004;
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

Two routes. If you want a free hostname and the least work, skip to
[A free hostname instead](#a-free-hostname-instead-recommended) — it needs no
domain, no certbot and no open ports. What follows is the route for a domain you
own and control.

You need a domain you actually own: Let's Encrypt refuses by policy to issue for
`*.compute.amazonaws.com`, so the hostname EC2 hands you can never have a
certificate. Any registrar is fine; about $10 a year.

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

**Port 3004 must not appear in that list.** It is the unauthenticated app; nginx
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

## A free hostname instead (recommended)

You do not have to buy a domain. [Tailscale](https://tailscale.com/docs/features/tailscale-funnel)
hands out a hostname on its own `ts.net` domain and provisions a browser-trusted
certificate for it automatically — the same deal Vercel gives you, and it is on
the free plan. It needs **no domain, no Elastic IP, no certbot, and no inbound
ports**: traffic arrives over Tailscale's relays rather than by connecting to the
instance, so the security group can stay SSH-only.

On the instance:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                       # prints a link to authenticate
```

In the Tailscale admin console, enable **MagicDNS** and **HTTPS Certificates** for
the tailnet (both under DNS). Then pick one:

**Private — reachable from your devices, nobody else's.** This is the one to use.

```bash
sudo tailscale serve --bg 3004
sudo tailscale serve status             # prints the https://<host>.<tailnet>.ts.net URL
```

Open that URL from any laptop or phone signed into your tailnet. It solves the
authentication problem rather than papering over it: the app has no login, and
with `serve` nobody outside your tailnet can reach it at all — no password to
leak, no port to scan.

**Public — open to the whole internet.** Only if someone without Tailscale needs
in. Funnel may need enabling for the node in the admin console first, and it can
only listen on 443, 8443 or 10000.

```bash
sudo tailscale funnel --bg 3004
sudo tailscale funnel status
```

If you do this, put the nginx basic auth from
[Reaching it](#reaching-it) in front and point Funnel at nginx instead of at
3004 — a public URL to an app with no login is an open relay to your Gmail.

### Other free options

- **DuckDNS** — a free `you.duckdns.org` subdomain that works with the nginx and
  certbot path above. More moving parts than Tailscale: you still open 80 and
  443, and because DuckDNS allows only one TXT record per domain you need
  `certbot-dns-duckdns` (or HTTP-01 with port 80 already reachable).
- **Cloudflare quick tunnel** — `cloudflared tunnel --url http://localhost:3004`
  gives an instant `*.trycloudflare.com` HTTPS URL with no account. Fine for
  showing someone the UI for ten minutes; the URL changes on every restart, so
  it is not a deployment.

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
