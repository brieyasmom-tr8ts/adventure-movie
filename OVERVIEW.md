# Adventure Movie Maker — what I'm building

A kid-friendly choose-your-own-adventure web app for families with multiple readers across reading levels (Pre-K through 6th grade). Each kid has a profile (name, cartoon avatar, reading level). They tap through branching stories — hand-crafted, AI-generated, and family-made — toward one of several endings. The whole personality is calm, warm, and tap-when-ready: no countdown timers, no auto-advance, no anxiety-inducing pressure.

## Home screen

- **Today's Adventure** — a fresh AI-generated story daily, personalized per kid by a Cloudflare Worker cron at 5 AM UTC.
- **Today's Bible Verse** — rotates daily, opens into game-style verse memorization.
- **Story rows by category**: Start Reading (Pre-K – K), Growing Reader (1st – 2nd), Brave Reader (3rd – 4th), Story Master (5th – 6th), Teen / Social, Bible, Memory Verses, Grandbabe Stories, Community Adventures (top 10, 2 × 5 grid), Life Decisions.
- **Make My Own Story** — kid types a topic, AI runs with it.

## Three core flows

1. **Daily Story** — Cron Worker (`workers/daily-story`) generates one shared outline + four leveled narrations (L1 – L4) plus per-kid avatar-faced scene images via fal.ai `instant-character`. Saves to KV. Client walks the pre-generated scenes as a fixed branching tree — no live AI per tap, no infinite loops.
2. **Static / Multi-Level Stories** — Bible stories (Noah, David, Esther, Jonah) authored at all 4 levels and auto-routed to the kid's profile level. Hand-crafted Teen / Social, Memory Verses, etc. are single-level.
3. **Grandbabe Story Workshop** (`/grandbabe`) — family members write a one-paragraph story idea; Claude turns it into a playable branching adventure with the kid's name auto-inserted via a `{name}` placeholder. The author can edit it ("add a scene with a fox", "make the ending happier") or delete it. Stories appear in a "Grandbabe Stories" row on the kids' home.

## Memory Verses (game mode, not stories)

Pick a verse → tap a game type (Fill the Blanks / Word Order) → pick Easy / Medium / Hard → play. Timer + per-verse-per-game-per-difficulty best times stored locally. Currently 4 verses: John 3:16, Psalm 23:1, Philippians 4:13, Proverbs 3:5-6.

## Community Adventures

When a kid finishes an AI Adventure, the journey auto-saves to KV. Top 10 newest appear on home in a 2 × 5 grid. Admin delete via `?admin=<token>` URL.

## Tech stack

- **Static site + Cloudflare Pages Functions** (`functions/api/*`): `generate.js`, `avatar.js`, `today.js`, `profiles.js`, `grandbabe-stories.js`, `edit-story.js`, `community-stories.js`, `tts.js`, `story-editor.js`, `family.js`, `daily-image/`, `upload-avatar.js`.
- **Cloudflare KV** (`STORIES_KV`) — profiles, daily stories, narrations, community pool, Grandbabe pool.
- **Cloudflare R2** (`IMAGES_R2`) — per-kid scene art.
- **Cron Worker** (`workers/daily-story`) — outline + narrations + per-kid avatar scenes via fal.ai's queue API (must poll `status_url` then GET `response_url`; the sync `fal.run` endpoint has hard timeouts that break for slower models).
- **Anthropic Claude** for all story generation; **OpenAI** for cartoon-avatar conversion; **fal.ai** `instant-character` for per-kid scene images.
- **Deploy** — GitHub Actions → Cloudflare Pages + Worker on push to main.

## Design rules

- Wait for the kid's tap. No countdown timers. No auto-advance.
- Auto-route to the kid's profile level when multi-level versions exist.
- Stories with `verseGame:true` route to the verse-game screen, not the story player.
- Cloudflare network is blocked from Claude's sandbox — deploys go through GitHub Actions, not direct `wrangler deploy`.

## Known gotchas

- **Fal.ai queue**: `https://queue.fal.run/<model>` returns only `{request_id, status_url, response_url}`. Treating the submit response as synchronous (reading `result.images[0].url`) means no images ever land.
- **iPhone library uploads**: HEIC photos get rejected by OpenAI's images/edits API. `index.html` normalizes via `<img>` + canvas to JPEG before upload.
- **Daily story `nextScene` indexing**: the outline LLM is usually 0-indexed, but auto-detect by counting self-loops under each interpretation. Wrong choice produces "every choice replays the same scene."
- **Multi-level stories**: `endingCount()` and similar must read from `story.levels.LX.scenes` when `story.scenes` is undefined, or the home page blanks out.
