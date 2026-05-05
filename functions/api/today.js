// Cloudflare Pages Function — serves today's story for a kid.
// Route: GET /api/today?kid=<profile-id>[&level=L1|L2|L3|L4]
// Binding: STORIES_KV
//
// Returns the kid's pre-generated personalized story (with avatar images)
// when their stored level matches the requested level. If they switched
// levels since the cron ran, falls back to the level's narration without
// avatar-personalized images so they still see today's story at the right
// reading level.

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  const url = new URL(request.url);
  const kidId = url.searchParams.get("kid");
  const requestedLevel = url.searchParams.get("level");
  if (!kidId) return json({ error: "kid param required" }, 400);

  const today = new Date().toISOString().slice(0, 10);

  // 1. Try the kid's pre-generated story for today.
  let story = await env.STORIES_KV.get(`story:${kidId}:${today}`, "json");

  // 2. Fall back to "latest" (yesterday's, if today's hasn't generated yet).
  if (!story) {
    story = await env.STORIES_KV.get(`story:${kidId}:latest`, "json");
  }

  // If we have a story and either no level was requested or the levels match,
  // return it as-is (has the avatar-personalized images).
  if (story && (!requestedLevel || !story.level || story.level === requestedLevel)) {
    return json({ story });
  }

  // 3. Level mismatch (or no per-kid story) — try today's leveled narration.
  if (requestedLevel && /^L[1-4]$/.test(requestedLevel)) {
    const narrations = await env.STORIES_KV.get(`narrations:${today}`, "json");
    const narration = narrations && narrations[requestedLevel];
    if (narration) {
      return json({
        story: {
          ...narration,
          date: today,
          level: requestedLevel,
          // No per-kid images in this fallback path — frontend will use the
          // kid's avatar as the hero image instead.
          source: "narration-fallback"
        }
      });
    }
  }

  // If we had a per-kid story (wrong level) but no narration cached,
  // returning what we have is still better than a 404.
  if (story) return json({ story });

  return json({ error: "No story available yet. Check back after 5 AM!" }, 404);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
