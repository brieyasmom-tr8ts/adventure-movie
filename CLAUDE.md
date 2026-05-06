# Notes for Claude working on this repo

This file is durable instruction. Read it at session start and act on it without re-asking.

## Standing authorization — just do these, don't ask

The repo owner has pre-authorized the following. Don't pause to confirm:

- **Push** to any branch I'm working on, including `main`.
- **Open PRs**, merge them, and merge feature branches into `main` directly when asked.
- **Trigger CI workflows** (push, `workflow_dispatch`, re-runs).
- **Hit the live worker's `/trigger`** endpoint and the live Pages site as needed for verification.
- **Edit GitHub Actions workflows** to fix or extend deployment.
- **Commit straight to the assigned feature branch** (currently `claude/deploy-daily-story-worker-TKVUN`) without staging-area drama.

Things that still warrant a quick confirm: force-pushes, history rewrites (`reset --hard`, rebasing pushed commits), deleting branches, rotating secrets, anything that touches another user's repo.

If I say "deploy it," "ship it," "push it," or "merge to main" — that's the green light. Don't relitigate. Don't propose a safer alternative unless what I asked is actually broken.

## What can and can't be done from this sandbox

- **Cloudflare API is blocked** at the network layer (`Host not in allowlist`). `wrangler whoami`, `wrangler deploy`, `wrangler secret put`, and `curl https://*.workers.dev` will all fail from here regardless of credentials. Don't try them — go through GitHub Actions instead.
- **GitHub** is reachable via the configured MCP tools and via `git push` to the local remote. Use those.
- **Interactive prompts** (e.g. `wrangler secret put` waiting for stdin) won't work; pipe values via env vars or push secrets through a workflow with `cloudflare/wrangler-action@v3` and the `secrets:` input.

## Deployment topology

- **Pages site** (`index.html` + `functions/`): deployed by `.github/workflows/deploy.yml` on push to `main`.
- **Daily-story worker** (`workers/daily-story/`): deployed by `.github/workflows/deploy-worker.yml` on push to `main` (or this feature branch) when `workers/daily-story/**` or the workflow itself changes. The workflow also syncs `ANTHROPIC_API_KEY` and `FAL_API_KEY` from GitHub Actions secrets to Cloudflare and POSTs `/trigger` so today's run starts immediately.
- **Worker cron**: daily at 5:00 AM UTC (`workers/daily-story/wrangler.toml`).

## GitHub Actions secrets in use

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ANTHROPIC_API_KEY`
- `FAL_API_KEY`
- `OPENAI_API_KEY` is set on Cloudflare Pages (env vars), not in Actions — it's only needed at runtime by `/api/avatar`.

## Worker endpoints

- `POST https://adventure-movie-daily.<subdomain>.workers.dev/trigger` — runs today's generation immediately. Used by the deploy workflow.
- `scheduled` cron — runs the same path daily at 5 AM UTC.

## Community Adventures (auto-shared AI stories)

When a kid finishes an AI Adventure, the full journey is auto-posted to `/api/community-stories` and surfaced in a "Community Adventures" row on the home screen labeled "Made by &lt;name&gt;". Replays are linear playback of the saved scenes — zero Anthropic tokens.

- KV layout: full record at `community:<uuid>`, summary list at `community:_index` (newest first, capped at 200).
- Dedupe: same `(storyId + ordered choice texts)` SHA-1 path → bumps `replayCount` instead of creating a duplicate.
- Admin delete: `DELETE /api/community-stories?id=<id>` requires `Authorization: Bearer <ADMIN_TOKEN>`. The Cloudflare Pages env var `ADMIN_TOKEN` must be set, otherwise DELETE returns 503. Parents capture the token client-side by visiting `/?admin=<token>` once on each device — it's stripped from the URL and stored in `localStorage.am_admin_token`. The delete `×` only renders when that key is present.

## Fal.ai queue API gotcha (already fixed)

`https://queue.fal.run/<model>` is the **async** submit endpoint — it returns `{request_id, status_url, response_url, queue_position}` only. To get the actual image you must poll `status_url` until `status === "COMPLETED"` and then GET `response_url` for the result body. The original `workers/daily-story/index.js` treated the submit response as if it were synchronous (`result.images[0].url`), so the URL was always undefined and no images ever got saved. If you swap models, keep the queue-poll pattern — sync `https://fal.run/<model>` has hard timeouts that break for slower models like `instant-character`.

## Avatar pipeline gotcha (already fixed)

iPhone photo-library uploads come through as HEIC; OpenAI's images/edits API rejects HEIC. `index.html` (`normalizeAvatarImage`) decodes any browser-renderable file via `<img>` and re-encodes through a canvas as JPEG before posting to `/api/avatar`. If the upload path regresses, that function is the first place to look.
