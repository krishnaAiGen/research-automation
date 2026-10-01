# Research Outreach

A Next.js app for emailing the authors of papers scraped by
[`openreview-scrapper`](../openreview-scrapper). It is a port of that repo's
`email_generator/send_emails.py` with a UI on top: configure the prompt, choose
how many of the remaining addresses to email, watch the analytics, and put the
whole thing on a schedule.

## What it does

For each unsent author address, the same three steps the Python script ran:

1. Send the paper's title + abstract to an LLM (via OpenRouter) and get back a
   topic phrase, N research queries, and the first name of the author the
   address belongs to.
2. Render those into the email template.
3. Deliver it over Gmail SMTP, and record it.

The record is what stops anyone being emailed twice.

The Python `sent_log.jsonl` is **not** imported by default. Pass
`--with-history` if you ever want those 1,306 addresses marked as already
contacted:

```bash
npm run import -- --with-history
```

> **Reachable by anyone but you?** Set `AUTH_USERNAME` and `AUTH_PASSWORD` in
> `.env.local` and the app requires a sign-in before any page or API route
> responds. Leave them unset and there is no login at all — fine on localhost,
> reckless anywhere else, since the app can send mail from your Gmail.

> **Don't want the AI involved?** Untick **Use AI** on the User prompt card on the
> Email prompt page. The email template is then sent exactly as written, with the
> conference, sender and recipient placeholders filled in — no model call, no
> OpenRouter key needed, and identical output every time.

> **Deploying?** See [DEPLOY.md](DEPLOY.md). This app needs a writable disk and a
> long-lived process, so it cannot run on Vercel or any other serverless host —
> not for want of a database driver, but because the scheduler needs a process
> that stays alive. Render, Railway, Fly, or a VPS run it unchanged.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in the keys
npm run import                 # load papers + author addresses
npm run dev                    # http://localhost:3000
```

Then open **Email prompt** and set the product URL, demo URL, and the sender
name in the signature — they ship as visible `[SET PRODUCT URL]`-style
placeholders so an unedited template is impossible to send by accident.

`.env.local`:

| Variable | Needed for |
| --- | --- |
| `OPENROUTER_API_KEY` | Drafting with the model. Not needed if you untick **Use AI** and send the template as written. |
| `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` | Delivery. A Google [App Password](https://myaccount.google.com/apppasswords), not your login password. Without these a batch refuses to start. |
| `GMAIL_FROM_NAME` | Display name on the message (optional). |
| `SCRAPER_ROOT` | Where `npm run import` reads `downloads/papers.json` and `email_generator/sent_log.jsonl` from. |
| `DATABASE_PATH` | Defaults to `./data/app.db`. |

The dashboard shows a banner listing whatever is still missing.

## The four screens

**Analytics** (`/`) — coverage against the full address pool, delivery rate,
daily send volume by outcome, coverage per venue track, top recipient domains,
and recent activity. Polls every 5s, so a running batch updates live.

**Email prompt** (`/prompt`) — the system prompt, the per-paper user prompt, and
the email template, each editable with its placeholder reference. Preview
renders against a real scraped paper; "Generate with model" calls OpenRouter so
you see actual queries before committing. Keep as many configurations as you
like: "Duplicate" copies the open one, "New for a hand-built list" starts from a
set written for addresses with no paper behind them. Every batch and schedule
picks the configuration it wants, so none of them have to share.

**Send** (`/campaigns`) — pick a recipient collection, then how many of its
remaining addresses to email (presets, a custom number, or all of them),
optionally filtered to one track. Shows the pool, the batch size against it, and
an estimated duration. **Every batch sends for real — there is no dry run.** To
test, put your own address in *Redirect to (testing)* and the whole batch goes
there instead, which also proves Gmail actually works. Running batches can be
paused, resumed, and cancelled, and each one has a detail page listing every
email sent.

**Schedule** (`/schedule`) — fire a batch of N emails from one collection on a
cadence, restricted to chosen weekdays and an hours-of-day window, with an
optional total cap. Each run creates a normal batch you can open and inspect.

**Recipients** (`/recipients`) — collections of addresses, searchable and
filterable by send state and track. See below.

## Collections

Addresses live in named collections. The scraped author pool is the first one;
build others by hand and point a batch or a schedule at whichever you want.

- **Add** one address, or many separated by commas (newlines and semicolons are
  accepted too). Invalid tokens and addresses already in the collection are
  reported rather than failing the whole paste.
- **Rename** a collection, **remove** individual addresses, and **delete** a
  whole collection — any of them, as long as one remains. Deleting the default
  promotes another, since `npm run import` and a batch's fallback both need one.
  A collection an enabled schedule points at is refused until you pause it.
- The same address may sit in two collections. That does not make it reachable
  twice: "never emailed twice" is enforced against the send log, not the list.
- Deleting a collection never deletes its sends. Those are the record of who was
  contacted, and losing them would let the same people be emailed again from a
  rebuilt list.

A hand-added address has **no paper**, so `{{title}}`, `{{abstract}}` and
`{{authors}}` render empty and the paper prompt produces "Congrats on your paper,
 —". Two extra placeholders exist for these rows instead:

| Placeholder | Filled from |
| --- | --- |
| `{{name}}` | The greeting name typed in when the address was added |
| `{{notes}}` | The free-text context typed in when the address was added |

Rather than writing that prompt yourself, click **New for a hand-built list** on
the Email prompt page: it creates a configuration built around those two, and
carries the product and demo URLs over from the one you have open.

`npm run import` only ever writes to the scraped collection. Hand-built lists
are never touched by an import or by `npm run reset`.

## Notes on behaviour

- **Nobody is emailed twice, unless you ask.** Eligibility is `NOT EXISTS (a
  successful send to this address)`, checked both when the queue is built and
  again immediately before each send, so two concurrent batches can't collide.
  Addresses differing only in case are one person, and so is the same address in
  two collections. Ticking **Allow re-sending** on a batch drops that clause for
  that batch alone — which is how you send a reminder, or test against your own
  address a second time.
- **"Available to email now" is the number the batch will actually find.** The
  count and the queue run the same eligibility clause, which also excludes
  papers with no abstract to generate from — so the figure on the button is a
  few hundred lower than the raw unsent count, and honest.
- **Deleting a batch keeps its sends.** They are the record of who was
  contacted; dropping them would let those people be emailed again.
- **A crash pauses rather than loses.** Anything left `running` at startup is
  marked `paused` and can be resumed; the pool query means it picks up exactly
  where it stopped.
- **A run of failures pauses the batch instead of burning the queue.** Ten
  consecutive failures — or a single authentication failure, which means the
  account is throttled rather than the address being bad — park the batch for an
  hour. The scheduler resumes it automatically and retries exactly the addresses
  that did not succeed, since eligibility is keyed on successful sends. After
  three cooldowns without a success the batch stops with `failed`. A success
  resets both counters.
- **An auth failure never triggers a reconnect.** Gmail's `454 4.7.0 Too many
  login attempts` is a complaint about logging in, so reconnecting and retrying
  three times per message — which is what the generic transient path did — makes
  it strictly worse. Those errors now fail the message immediately and let the
  breaker back off.
- **SMTP connections recycle every 50 messages**, because Gmail expires
  long-lived connections and a large batch always outlives one. Transient
  failures reconnect and retry; permanent rejections fail fast and are counted.
- **The model is one of two, chosen per prompt configuration** in the dropdown on
  the Email prompt page. The list lives in `src/lib/models.ts`.

  | Model | Tradeoff |
  | --- | --- |
  | `nvidia/nemotron-3-ultra-550b-a55b:free` (default) | Free, but **20 requests/minute and 50/day** — 1,000/day once $10 of credits has ever been bought |
  | `deepseek/deepseek-v4-flash` | Paid, ~$0.08 per million input tokens, no daily cap |

  One email is one request, so on the free variant that daily cap — not the send
  delay — decides how long a batch takes: a 5,000-address pool is five days at
  1,000/day and over three months at 50/day. Switch to DeepSeek if that is too
  slow. The 3,000 ms default delay already sits exactly at the free variant's
  20/min ceiling, so do not lower it while on it.

  Nothing rewrites a saved model on startup, so a configuration keeps whichever
  you picked. A model that is not in the list (set before the dropdown existed,
  or by hand in the database) stays selected and is shown as such rather than
  being silently replaced.
- **Three research queries per email, not configurable.** `QUERIES_PER_EMAIL` in
  `src/lib/models.ts` is what `{{count}}` resolves to in a user prompt and how
  many `{query N}` lines a template needs. Editing a template to have a
  different number of slots warns you under the editor, because the mismatch is
  silent otherwise: extra queries are generated and discarded, extra slot lines
  are stripped out of the email.
- **Not every model accepts `response_format`.** Free variants generally don't.
  The request sends it, and retries once without it if the provider rejects it;
  the prompts ask for JSON in words anyway, and the parser pulls the JSON out of
  surrounding prose — which reasoning models emit whenever they are not held to
  a schema.
- **Imported history has no real timestamps.** The Python log never recorded
  them, so `--with-history` spreads those sends backwards from the log file's
  mtime. The ordering is truthful; the precision is not.

## Starting over

```bash
npm run reset              # clear sends, batches, schedules
npm run reset -- --prompts # also restore the prompt to the built-in default
```

Papers and recipients are left alone — re-scraping them is expensive and they
carry no send state. The database is copied to `data/app.backup-<timestamp>.db`
first, since deleting the send log is exactly what stops someone being emailed
twice.

## Layout

```
scripts/import.ts          papers.json (+ optional sent_log.jsonl) -> SQLite
scripts/reset.ts           clear send history, with a backup first
src/lib/db.ts              schema, migrations, default + contact prompts
src/lib/auth.ts            session signing, edge-safe (WebCrypto only)
src/lib/images.ts          uploaded images: validation, storage, safe lookup
src/middleware.ts          gates every page and API route on a session
src/lib/models.ts          the selectable models and their tradeoffs
src/lib/collections.ts     recipient lists: CRUD, bulk add, counts
src/lib/emails.ts          parse a pasted blob of addresses
src/lib/openrouter.ts      query generation + response parsing
src/lib/render.ts          template placeholder substitution
src/lib/mailer.ts          Gmail SMTP with connection recycling
src/lib/runner.ts          batch execution, pause/resume, dedupe
src/lib/scheduler.ts       30s tick, windows, cadence
src/lib/bootstrap.ts       once-per-process startup (scheduler, stale-run reset)
src/lib/stats.ts           every analytics query
src/app/…                  pages + API routes
```

The scheduler starts from `src/lib/bootstrap.ts`, imported for its side effect
by the Node-runtime API routes — so it begins on the first request and only
runs while the app does. It deliberately does **not** live in
`instrumentation.ts`: Next compiles that file for the edge runtime too, and the
edge bundler cannot resolve better-sqlite3's `fs` dependency (a `NEXT_RUNTIME`
check inside `register()` runs too late to prevent it).
