# Meera Content Agent

A Telegram bot that turns Meera Pillai's raw notes into LinkedIn drafts in her own voice - and then **stops**. Meera reviews every draft and publishes it herself.

```
capture → evaluate → research → draft → review
```

The system is an assistant, not an autopilot. It never publishes, never schedules, never approves on its own, and never deletes anything.

---

## Contents

1. [How it works](#how-it-works)
2. [The human-authorship boundary](#the-human-authorship-boundary)
3. [Project structure](#project-structure)
4. [Environment variables](#environment-variables)
5. [Setup guide (Steps 1-11)](#setup-guide)
6. [Everyday use](#everyday-use)
7. [Changing behaviour without touching code](#changing-behaviour-without-touching-code)
8. [Testing](#testing)
9. [Logs and debugging](#logs-and-debugging)
10. [Design decisions](#design-decisions)
11. [Troubleshooting](#troubleshooting)

---

## How it works

```
Meera sends a note in Telegram
        │
        ▼
POST /api/webhook ── wrong secret? → 401, ignored
        │
        ▼
Save raw note in Supabase ── same message seen before? → stop (duplicate)
        │                       (Telegram gets "200 OK" here, immediately)
        ▼  (continues in the background)
SCORE the note 0-10 (Gemini)
        │
        ├── score < 6 → "This one isn't strong enough…" → note = rejected → STOP
        │
        ▼ score ≥ 6
Load the Voice Skill (Supabase, else voice-skill.txt)
        │
        ▼
Extract 3-5 keywords + a search query (Gemini)
        │
        ▼
Search Google News, last 30 days (free, no key)
        │
        ▼
Is any article GENUINELY relevant? (Gemini) ── no → draft without news
        │ yes
        ▼
Write the draft in Meera's voice (Claude; Gemini if Claude fails)
        │
        ▼
Style check + attach NEWS SOURCE / ⚠ verification block if news was used
        │
        ▼
Save draft (status = pending) → send to Telegram
        │
        ▼
Meera replies APPROVE or REJECT → status updated. Nothing is published.
```

Every step writes its result to Supabase, so the full history (note, score, reason, search, news, draft, decision) is always inspectable.

---

## The human-authorship boundary

These rules are built into the code, not just the prompts:

| Rule | Where it's enforced |
|---|---|
| Never publishes or schedules | There is no LinkedIn integration at all. The only outbound services are Gemini, Claude, Google News, Telegram and Supabase. A test checks this. |
| Only Meera approves | `status = approved` is set only by `lib/commands.ts`, only from her APPROVE message, only on a `pending` draft. |
| She sees what she approves | If a draft can't be delivered to Telegram, it's marked `error`, not `pending`, so a bare APPROVE can never approve a draft she hasn't seen. |
| Nothing is deleted | `lib/database.ts` has no delete functions. Rejected notes and drafts stay. |
| News claims are flagged | Every draft that uses news gets the `NEWS SOURCE … ⚠ Check this before publishing` block. The model is told it has only the headline and must not claim more. |
| No invented facts | The drafting prompt forbids invented statistics, experiences, quotes and company practices. Where a post needs a fact she didn't give, it writes a `[DATA NEEDED: …]` / `[COMPANY PRACTICE NEEDED: …]` / `[VERIFY: …]` placeholder, and the Telegram message tells her how many there are. |

---

## Project structure

```
├── app/
│   ├── api/
│   │   ├── webhook/route.ts     Telegram → here. Checks secret, answers 200 fast, runs pipeline after.
│   │   └── health/route.ts      GET /api/health: which env vars are missing (names only).
│   ├── layout.tsx, page.tsx     A one-line home page (the app has no web UI).
│
├── lib/
│   ├── webhookHandler.ts        Routes each Telegram update: command, note, or ignore.
│   ├── pipeline.ts              The note pipeline - calls each stage in order, records status.
│   ├── stages/
│   │   ├── scoreNote.ts         Stage 1: score 0-10 + reason.
│   │   ├── extractKeywords.ts   Stage 2: 3-5 keywords + a search query.
│   │   ├── checkNewsRelevance.ts Stage 4: is any article genuinely relevant?
│   │   ├── findNewsAngle.ts     Stages 2-4 together; never throws (news is optional).
│   │   └── writeDraft.ts        Stage 5: draft with Claude (Gemini fallback), validate, style-check.
│   ├── commands.ts              APPROVE / REJECT / /start / /help.
│   ├── messages.ts              Every message the bot sends - edit wording here.
│   ├── telegram.ts              Telegram Bot API: parse updates, send messages, typing indicator.
│   ├── gemini.ts                Gemini REST client + "JSON, validate, retry once" helper.
│   ├── claude.ts                Claude (Anthropic SDK) client for drafting.
│   ├── news.ts                  Google News RSS search + parsing.
│   ├── voice.ts                 Loads the Voice Skill (Supabase → voice-skill.txt).
│   ├── database.ts              Every Supabase query. No deletes.
│   ├── supabase.ts              Supabase client (server-side only).
│   ├── validation.ts            Validators for every AI output.
│   ├── styleCheck.ts            Checks drafts against her measurable style (no emojis, em dashes…).
│   ├── config.ts                Reads env vars; clear errors when one is missing.
│   ├── logger.ts                [STAGE]-prefixed logs with secret redaction.
│   ├── errors.ts, http.ts, types.ts
│
├── prompts/                     All AI instructions, separate from code.
│   ├── scoring.ts               "Is this note substantive enough?" + scale + examples.
│   ├── keywordExtraction.ts     Note → search terms.
│   ├── newsRelevance.ts         "Does this article genuinely add context?"
│   ├── drafting.ts              Draft brief: audience, fact rules, format. Style comes from the Voice Skill.
│   ├── jsonRetry.ts             The stricter retry message for malformed JSON.
│   └── context.ts               Shared facts about Meera and her audience.
│
├── database/schema.sql          Creates the three tables. Run once in Supabase.
├── voice-skill.txt              Meera's Voice Skill (built from her 15 published pieces).
├── docs/voice-model-source.txt  The full forensic voice analysis voice-skill.txt was taken from.
│
├── scripts/                     Command-line helpers (see "Everyday use").
├── tests/                       Automated tests (npm test).
│
├── .env.example                 Template for your secrets. Copy to .env.
├── next.config.ts, tsconfig.json, vitest.config.ts, package.json
```

---

## Environment variables

Put these in `.env` for local use, and in **Vercel → Project → Settings → Environment Variables** for the live app. `.env` is in `.gitignore` - never commit it.

| Variable | Required? | What it is | Where to get it |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Your bot's password for the Telegram API. | @BotFather in Telegram, when you create the bot (Step 1). Looks like `1234567890:AAE…`. |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | A random string you invent. Telegram sends it with every message so the app can ignore fake requests. | Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Strongly recommended | Chat IDs allowed to use the bot, comma-separated. Empty = anyone who finds the bot can use it (and spend your AI credits). | Send `/start` to your bot - it replies with your chat ID (Step 9). |
| `GEMINI_API_KEY` | Yes | Google AI key. Used for scoring, keywords, relevance, and as the drafting fallback. | [Google AI Studio](https://aistudio.google.com/apikey) → Create API key. |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.5-flash`. | - |
| `ANTHROPIC_API_KEY` | Recommended | Claude key, used for drafting. If empty, Gemini drafts instead. | [Anthropic Console](https://console.anthropic.com/) → API Keys. |
| `CLAUDE_MODEL` | No | Defaults to `claude-opus-5`. | - |
| `DRAFTING_PROVIDER` | No | `claude` or `gemini`. Empty = Claude if its key is set, otherwise Gemini. Useful for comparing the two. | - |
| `SUPABASE_URL` | For saving + APPROVE/REJECT | Your Supabase project's address. | Supabase → Project Settings → Data API (or API) → Project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | For saving + APPROVE/REJECT | Server-side secret key for the database. | Supabase → Project Settings → API Keys → the **secret** key (`sb_secret_…`) or the legacy **service_role** key. |

### Running before the database is connected

Following the case's build order (L3 first, memory in B1·3), the bot works before Supabase is set up: notes are scored, researched and drafted, and drafts arrive in Telegram marked **"DRAFT READY (not saved)"**. Nothing is stored, replies never claim otherwise, and APPROVE / REJECT answer that they need the database. `/api/health` shows `"database": "not configured …"`.

To switch memory on: run `database/schema.sql` in Supabase, add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Vercel (and `.env`), and redeploy. No code changes.

**Why there's no `SUPABASE_ANON_KEY`:** the anon (public) key is for code that runs in a browser. This app only talks to Supabase from the server, so it only needs the secret key - and the schema turns on Row Level Security so the anon key can't read or write anything anyway. One less secret to manage.

---

## Setup guide

You need: [Node.js 20.12+](https://nodejs.org/) (22 or 24 recommended), a Telegram account, and free accounts on [GitHub](https://github.com), [Supabase](https://supabase.com) and [Vercel](https://vercel.com).

### STEP 1 - Create the Telegram bot

1. In Telegram, open a chat with **@BotFather**.
2. Send `/newbot`, choose a display name (e.g. "Meera Drafts") and a username ending in `bot` (e.g. `meera_drafts_bot`).
3. BotFather replies with a token like `1234567890:AAE…`. That's `TELEGRAM_BOT_TOKEN`. Keep it secret.

*Optional - use a private channel instead of a direct chat:* create the channel, add the bot as an **administrator** (with permission to post). Notes posted in the channel then work exactly like direct messages, and drafts come back to the channel.

### STEP 2 - Create the Supabase project

1. [supabase.com](https://supabase.com) → **New project**. Pick a name, a database password (save it somewhere), and a region close to Mumbai (e.g. Mumbai / Singapore).
2. Wait for it to finish setting up (~2 minutes).
3. Copy the **Project URL** → `SUPABASE_URL`, and the **secret / service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (see the table above for where).

### STEP 3 - Run schema.sql

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Open `database/schema.sql`, copy all of it, paste, click **Run**.
3. Check **Table Editor**: you should see `notes`, `drafts` and `voice_skill`.

It's safe to run again later - it won't delete anything.

### STEP 4 - Add the Voice Skill

`voice-skill.txt` is already in the project. It is copied section by section from the forensic analysis of Meera's 4 LinkedIn posts and 11 newsletters (`docs/voice-model-source.txt`): measured sentence lengths, punctuation counts, how she opens and ends, how she grades certainty, what she never does. It is **not** generic writing advice.

You don't have to do anything else: the first time a note is drafted, the app copies `voice-skill.txt` into the `voice_skill` table as version 1. To load it into Supabase straight away instead (after Step 5):

```bash
npm run voice:upload
```

### STEP 5 - Add the API keys

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env` and fill in the values from the table above. Then confirm git will ignore it:

```bash
git check-ignore .env
```

It should print `.env`. If it prints nothing, stop and fix `.gitignore` before committing anything.

### STEP 6 - Run locally

First, try the AI part on its own - no Telegram or Supabase needed, just `GEMINI_API_KEY` (and `ANTHROPIC_API_KEY` to draft with Claude):

```bash
npm run try -- "Most skincare brands talk about percentage concentration. But percentage alone doesn't tell you whether an active will actually work."
```

You'll see the score, the search, whether news was used and why, and the exact message the bot would send. Try a weak note too:

```bash
npm run try -- "Call supplier tomorrow."
```

Then run the tests:

```bash
npm test
```

To run the **whole agent** on your computer against real Telegram and Supabase - before deploying anything - use polling (works only while no webhook is set):

```bash
npm run dev:poll
```

Post notes in your channel (or chat with the bot) and the replies come back exactly as they will from Vercel. Stop it with Ctrl+C.

Alternatively, run the web server locally:

```bash
npm run dev
```

and, in a second terminal, send it a fake Telegram message (the reply arrives in your real Telegram chat - this needs `TELEGRAM_ALLOWED_CHAT_IDS` set to your chat ID, from Step 9):

```bash
npm run simulate -- "Everyone talks about 10% niacinamide, but the label percentage isn't enough to tell you whether it works."
```

### STEP 7 - Deploy to Vercel

1. Put the project on GitHub (from the project folder):

   ```bash
   git init
   ```
   ```bash
   git add .
   ```
   ```bash
   git status
   ```
   Check that `.env` is **not** in the list. Then:
   ```bash
   git commit -m "Meera content agent MVP"
   ```
   Create an empty **private** repository on GitHub, then run the commands GitHub shows under "…or push an existing repository from the command line" (`git remote add origin …`, `git branch -M main`, `git push -u origin main`).

2. [vercel.com](https://vercel.com) → **Add New… → Project** → import the GitHub repository. Vercel detects Next.js automatically.
3. Before clicking Deploy, open **Environment Variables** and add every variable from your `.env` (same names, same values).
4. Click **Deploy**. When it finishes, copy the production URL, e.g. `https://meera-content-agent.vercel.app`.
5. Visit `https://YOUR-URL/api/health`. You want `"ok": true` and an empty `missingEnvVars` list.

If you change an environment variable later, redeploy (Vercel → Deployments → ⋯ → Redeploy) for it to take effect.

### STEP 8 - Set the Telegram webhook

This tells Telegram: "deliver messages for this bot to this address". From the project folder (it reads the token and secret from `.env`):

```bash
npm run webhook:set -- https://YOUR-URL.vercel.app
```

It should print `Webhook set: https://YOUR-URL.vercel.app/api/webhook`.

*Browser alternative:* paste this into the address bar, replacing the three placeholders:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://YOUR-URL.vercel.app/api/webhook&secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>
```

You should see `"ok":true`. **Include the `secret_token` part** - without it the app rejects every message with 401.

Use the production URL, not a preview-deployment URL. To check the webhook at any time:

```bash
npm run webhook:info
```

### STEP 9 - Send a test message

1. Open your bot in Telegram and send `/start`. It replies with help text and **your chat ID**.
2. Put that ID in `TELEGRAM_ALLOWED_CHAT_IDS` (in Vercel, then redeploy, and in `.env`). From then on the bot ignores everyone else.
3. Send a weak note: `Call supplier tomorrow.` → within a few seconds: *"This one isn't strong enough to develop into a post yet…"*.
4. Send a strong note: `Most skincare brands talk about percentage concentration. But percentage alone doesn't tell you whether an active will actually work.` → you'll see "typing…", and within about 20-90 seconds a `DRAFT READY · #1` message.
5. In Supabase → Table Editor → `notes`, both notes are there with their scores; `drafts` has draft #1 with `status = pending`.

### STEP 10 - Test APPROVE

Reply `APPROVE`. The bot answers *"Approved and saved. I haven't published it — you remain the final publisher."* and then sends a clean, copy-ready version of the post. In Supabase, draft #1 now shows `status = approved` and an `approved_at` time. Nothing was posted anywhere.

### STEP 11 - Test REJECT

Send another strong note, wait for the draft, reply `REJECT`. The bot answers *"Rejected and saved. The note and draft remain in the archive."* In Supabase the draft shows `status = rejected` and `rejected_at`; both the note and the draft are still there.

---

## Everyday use

**In Telegram**

| You send | What happens |
|---|---|
| Any text note | Saved, scored, and drafted if it scores 6+. |
| `APPROVE` / `REJECT` | Decides the most recent pending draft. |
| Reply (Telegram's Reply) to a draft with `APPROVE` | Decides that specific draft. |
| `APPROVE 12` / `REJECT 12` | Decides draft #12. |
| `/start` or `/help` | How it works + your chat ID. |
| Voice note, photo, file | "I can only work with text notes for now…" |

Commands must be the whole message: "Reject the new supplier's quote" is treated as a note, not a command.

**In the draft message**

- `Score 8/10 · 432 words · drafted by claude-opus-5` - which model wrote it matters when you're comparing.
- `NEWS SOURCE … ⚠ Check this before publishing` - open the link and check the claim before you approve.
- `TO FILL IN: 2 bracketed placeholders` - the draft needs a fact only you have (e.g. `[COMPANY PRACTICE NEEDED: …]`).
- `STYLE CHECK: …` - something her own writing never does (an exclamation mark, a hashtag, US spelling…). Fix it when editing.

**Command-line helpers**

| Command | Does |
|---|---|
| `npm run try -- "note"` | Dry run of scoring → news → draft. No Telegram, no database. |
| `npm run try -- --no-draft "note"` | Same, but stops before drafting (fast, cheap). |
| `npm run calibrate` | Scores a set of known-good and known-bad notes to check the scoring prompt. |
| `npm run voice:upload` | Saves `voice-skill.txt` to Supabase as a new active version. |
| `npm run webhook:set -- URL` / `npm run webhook:info` | Set / inspect the Telegram webhook. |
| `npm run simulate -- "text"` | Send a fake Telegram message to `npm run dev`. |
| `npm run dev:poll` | Run the whole agent on your computer by polling Telegram - no Vercel or webhook needed. Only works while no webhook is set. |
| `npm run telegram:check` | Read-only check: token valid? what kind of chat? is the bot an admin that can post? webhook status. |
| `npm test` | Run the automated tests. |

---

## Changing behaviour without touching code

- **Her voice:** edit `voice-skill.txt`, then `npm run voice:upload`. Or edit the active row in Supabase's `voice_skill` table directly. Takes effect on the next draft - no redeploy. Old versions are kept, and each draft records which version wrote it (`voice_skill_version`).
- **What counts as a strong note:** `prompts/scoring.ts` (the scale and the examples). Check the result with `npm run calibrate`. The threshold (6) is `NOTE_SCORE_THRESHOLD` in `lib/config.ts`.
- **What counts as relevant news:** `prompts/newsRelevance.ts`.
- **Draft rules (facts, format):** `prompts/drafting.ts`. Style belongs in the Voice Skill, not here.
- **The bot's wording:** `lib/messages.ts`.
- **Claude vs Gemini for drafting:** set `DRAFTING_PROVIDER=gemini` or `claude` (redeploy on Vercel), or compare locally:

  ```bash
  npm run try -- "your note"
  ```
  with `DRAFTING_PROVIDER` switched in `.env` between runs.

---

## Testing

```bash
npm test
```

The tests run offline in a couple of seconds: Gemini, Google News, Telegram and Supabase are replaced with in-memory fakes (`tests/helpers/`), and any unexpected network call fails the test.

| Required test | File | What it checks |
|---|---|---|
| 1. Strong note | `tests/pipeline.test.ts` | score ≥ 6 → draft saved as `pending` → sent with APPROVE/REJECT instructions; the Voice Skill reaches the drafting model. |
| 2. Weak note | `tests/pipeline.test.ts` | score < 6 → no keywords, news or draft; note `rejected`; explanation sent. |
| 3. News relevance | `tests/pipeline.test.ts` | Relevant → used, verification block attached, saved. Irrelevant → ignored, no block. Also: Google News down, no recent articles, drafter declines the news. |
| 4. APPROVE | `tests/commands.test.ts` | `approved` + `approved_at`; by reply and by number; duplicate APPROVE applied once; decided drafts unchanged. |
| 5. REJECT | `tests/commands.test.ts` | `rejected` + `rejected_at`; note and draft kept. |
| 6. Duplicate webhook | `tests/pipeline.test.ts` | Same message twice (and simultaneously) → one note, one scoring call, one draft. |
| 7. Malformed AI response | `tests/pipeline.test.ts`, `tests/validation.test.ts` | Bad JSON → one stricter retry → success; bad twice → note `error`, simple message, nothing malformed sent. |

Also covered: the secret-token check on the route, allow-listed chats, unsupported message types, empty messages, Claude → Gemini fallback, undeliverable drafts, Supabase outages, missing voice profile, RSS parsing, message splitting, the exact verification-block format, style checks, and log redaction.

`npm run typecheck` checks types; `npm run build` does the same production build Vercel runs.

---

## Logs and debugging

Vercel → Project → **Logs** (or the `npm run dev` terminal). Every line is prefixed with its stage:

```
[WEBHOOK] Message received {"chatId":…,"messageId":42,"type":"text"}
[DATABASE] Note saved {"noteId":17}
[SCORING] Note scored {"score":8,"reason":"…"}
[SCORING] Decision: develop {"noteId":17,"score":8,"threshold":6}
[KEYWORDS] Search terms extracted {"keywords":[…],"searchQuery":"…"}
[NEWS] News search finished {"results":6,"topHeadline":"…"}
[RELEVANCE] No news item used {"reason":"…"}
[VOICE] Using voice profile from Supabase {"version":1}
[DRAFTING] Draft created {"model":"claude-opus-5","words":447,"newsUsed":false,…}
[DATABASE] Draft saved {"draftId":9}
[TELEGRAM] Message sent
[PIPELINE] Finished - draft sent, waiting for APPROVE / REJECT
[COMMAND] Draft approved {"draftId":9}
```

Secrets never appear in logs: every line passes through `redact()` (`lib/logger.ts`), which strips the values of the secret env vars and anything shaped like a bot token or API key. Meera never sees error details - only a plain message - and the technical reason is saved in `notes.error_message` / `drafts.error_message`.

**Useful Supabase queries** (SQL Editor):

```sql
-- Everything, newest first
select n.id, n.created_at, n.score, n.status as note_status, left(n.raw_text, 60) as note,
       d.id as draft_id, d.status as draft_status, d.model_used, d.news_used
from notes n left join drafts d on d.note_id = n.id
order by n.created_at desc;

-- Anything that went wrong
select id, created_at, status, error_message from notes where status = 'error' order by created_at desc;
```

---

## Design decisions

- **Respond first, work after.** Scoring, research and a Claude draft take 20-90 seconds. Telegram re-sends a message if the webhook is slow, so the route saves the note, answers 200 immediately, and runs the pipeline with Next.js `after()`. `maxDuration = 300` gives it up to 5 minutes (the Vercel Hobby maximum with Fluid compute, which is on by default).
- **Duplicates are stopped by the database, not by memory.** `(telegram_chat_id, telegram_message_id)` is unique in `notes`, and `note_id` is unique in `drafts`. Even two copies of the same message arriving at once produce one note and one draft.
- **Gemini for mechanical steps, Claude for the draft.** Scoring, keywords and relevance are short, structured and cheap - Gemini Flash. The draft has to hold a voice across 350-550 words - Claude (`claude-opus-5`). If Claude fails, Gemini drafts and the draft says so. On `claude-opus-5` the request opts into Anthropic's server-side fallback (`fallbacks: "default"`), so a rare safety-classifier refusal is retried on another Claude model inside the same call.
- **News is optional by design.** The relevance check is told that choosing no article is normal. Any failure in the news steps just means "no news" - never a failed note. Google News is searched in both its India and international English editions, because the most useful context for a formulation point is often international.
- **Validate everything, retry once.** Every AI answer is parsed and validated (`lib/validation.ts`). One failure → one retry with a stricter prompt that says what was wrong. Two failures → the note is marked `error` and Meera gets a plain message. Malformed output never reaches her.
- **Style lives in the Voice Skill.** The drafting prompt adds facts and format rules but almost no style advice, so it can't pull drafts towards "good LinkedIn writing". A deterministic check afterwards catches the countable things (em dashes → spaced hyphens are fixed automatically; everything else is reported, never rewritten).
- **Plain-text Telegram messages.** No Markdown parsing, so nothing in a draft can break the message.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Bot doesn't reply at all | `npm run webhook:info` - is the URL right? Is there a "Last error"? Visit `/api/health`. In Vercel logs, a `401` means the `secret_token` in the webhook doesn't match `TELEGRAM_WEBHOOK_SECRET` - run `npm run webhook:set` again. |
| "This is a private bot" | Your chat ID isn't in `TELEGRAM_ALLOWED_CHAT_IDS` (or you forgot to redeploy after changing it). |
| "Something went wrong while working on this note" | Vercel logs → look for `[PIPELINE]` / `[AI]` lines. Usually a wrong `GEMINI_API_KEY` / `GEMINI_MODEL`, or a rate limit. Supabase `notes.error_message` has the reason. |
| "I couldn't save that note" | Supabase unreachable or the schema wasn't run - check `SUPABASE_URL`, the key, and Step 3. |
| Drafts sound generic | Check the `[VOICE]` log line - is a profile being loaded? Check `voice_skill` has an active row. Compare `DRAFTING_PROVIDER=claude` vs `gemini`. |
| Everything passes scoring | The prompt is too lenient - tighten the 4-5 band in `prompts/scoring.ts`, then `npm run calibrate`. |
| A note is stuck at `received` or `approved_for_drafting` with no reply | The function hit Vercel's 5-minute limit (very rare - e.g. both Claude and Gemini timing out). Check Vercel logs, then send the note again. |
| Draft arrives in two messages | Long draft + long news link exceed Telegram's 4,096-character limit, so it's split. APPROVE works on either part. |
