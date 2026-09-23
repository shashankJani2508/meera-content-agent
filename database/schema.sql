-- ─────────────────────────────────────────────────────────────────────────────
-- Meera Content Agent - Supabase schema
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole
-- file → Run. It is safe to run more than once.
--
-- Three tables:
--   notes        every raw note Meera sends, with its score and status
--   drafts       every LinkedIn draft, with its news source and approval status
--   voice_skill  versions of Meera's voice profile (one active at a time)
--
-- Nothing is ever deleted by the app. Rejected notes and drafts stay here as
-- history - they show what needs improving.
-- ─────────────────────────────────────────────────────────────────────────────


-- Keeps updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ── notes ────────────────────────────────────────────────────────────────────
create table if not exists public.notes (
  id                  bigint generated always as identity primary key,
  telegram_chat_id    bigint      not null,
  telegram_message_id bigint      not null,
  user_id             bigint,                -- Telegram user ID (empty for channel posts)
  raw_text            text        not null,
  score               smallint    check (score between 0 and 10),
  score_reason        text,
  search_keywords     text[],
  search_query        text,
  status              text        not null default 'received'
                      check (status in ('received', 'rejected', 'approved_for_drafting', 'drafted', 'error')),
  error_message       text,                  -- server-side detail when status = 'error'
  telegram_sent_at    timestamptz,           -- when Meera sent the message
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Duplicate protection: Telegram can deliver the same message twice.
  -- The same (chat, message) pair can only ever be saved once.
  constraint notes_telegram_message_unique unique (telegram_chat_id, telegram_message_id)
);

create index if not exists notes_status_idx on public.notes (status);
create index if not exists notes_created_at_idx on public.notes (created_at desc);

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();


-- ── drafts ───────────────────────────────────────────────────────────────────
create table if not exists public.drafts (
  id                           bigint generated always as identity primary key,
  note_id                      bigint      not null references public.notes (id) on delete restrict,
  telegram_chat_id             bigint      not null,
  draft_text                   text        not null check (length(trim(draft_text)) > 0),
  status                       text        not null default 'pending'
                               check (status in ('pending', 'approved', 'rejected', 'error')),
  model_used                   text,       -- e.g. claude-opus-5, or gemini-3.5-flash (fallback)
  voice_skill_version          int,        -- which voice profile version wrote it (empty = file)
  word_count                   int,
  style_warnings               text[],
  news_used                    boolean     not null default false,
  news_headline                text,
  news_source                  text,
  news_date                    timestamptz,
  news_url                     text,
  news_relevance_reason        text,       -- why the news was (or wasn't) used
  telegram_message_ids         bigint[],   -- the bot messages that carried this draft
  decision_telegram_message_id bigint,     -- Meera's APPROVE / REJECT message
  error_message                text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  approved_at                  timestamptz,
  rejected_at                  timestamptz,

  -- A news source is recorded whenever news is used.
  constraint drafts_news_fields_present check (
    not news_used or (news_headline is not null and news_source is not null and news_url is not null)
  )
);

-- One draft per note: a repeated webhook can never create a second draft.
create unique index if not exists drafts_one_per_note on public.drafts (note_id);
-- Fast lookup of "the latest pending draft in this chat".
create index if not exists drafts_chat_status_idx on public.drafts (telegram_chat_id, status, created_at desc);

drop trigger if exists drafts_set_updated_at on public.drafts;
create trigger drafts_set_updated_at
  before update on public.drafts
  for each row execute function public.set_updated_at();


-- ── voice_skill ──────────────────────────────────────────────────────────────
create table if not exists public.voice_skill (
  id           bigint generated always as identity primary key,
  profile_text text        not null check (length(trim(profile_text)) > 0),
  version      int         not null unique,
  is_active    boolean     not null default false,
  source       text,                          -- e.g. 'voice-skill.txt'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Only one profile can be active at a time.
create unique index if not exists voice_skill_one_active on public.voice_skill (is_active) where is_active;

drop trigger if exists voice_skill_set_updated_at on public.voice_skill;
create trigger voice_skill_set_updated_at
  before update on public.voice_skill
  for each row execute function public.set_updated_at();

-- Adds a new voice profile version and makes it the active one, in a single
-- step. Older versions are kept (just marked inactive).
-- Used by `npm run voice:upload` and by the app's first-run seed.
create or replace function public.publish_voice_skill(new_profile_text text, new_source text default null)
returns public.voice_skill
language plpgsql
set search_path = public
as $$
declare
  next_version int;
  result public.voice_skill;
begin
  -- Serialise concurrent publishes so two can't pick the same version number.
  lock table public.voice_skill in share row exclusive mode;
  select coalesce(max(version), 0) + 1 into next_version from public.voice_skill;
  update public.voice_skill set is_active = false where is_active;
  insert into public.voice_skill (profile_text, version, is_active, source)
  values (new_profile_text, next_version, true, new_source)
  returning * into result;
  return result;
end;
$$;


-- ── Security ─────────────────────────────────────────────────────────────────
-- Row Level Security on, with no policies: the public "anon" key can read or
-- write nothing. The app uses the server-side service-role key, which
-- bypasses RLS and never leaves the server.
alter table public.notes       enable row level security;
alter table public.drafts      enable row level security;
alter table public.voice_skill enable row level security;

revoke execute on function public.publish_voice_skill(text, text) from public, anon, authenticated;
grant execute on function public.publish_voice_skill(text, text) to service_role;

-- The app's server key may read, add and update rows - but not delete them.
-- (Harmless if your project already grants this by default.)
grant usage on schema public to service_role;
grant select, insert, update on public.notes, public.drafts, public.voice_skill to service_role;

-- Tell Supabase's API to pick up the new tables straight away.
notify pgrst, 'reload schema';
