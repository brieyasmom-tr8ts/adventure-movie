// Cloudflare Pages Function — serves today's pre-generated story for a kid
// Route: GET /api/today?kid=<profile-id>
// Binding: STORIES_KV

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  const url = new URL(request.url);
  const kidId = url.searchParams.get("kid");

  if (!kidId) {
    return json({ error: "kid param required" }, 400);
  }

  // Try today's story first
  const today = new Date().toISOString().slice(0, 10);
  let story = await env.STORIES_KV.get(`story:${kidId}:${today}`, "json");

  // Fall back to latest if today's isn't ready yet
  if (!story) {
    story = await env.STORIES_KV.get(`story:${kidId}:latest`, "json");
  }

  if (!story) {
    return json({ error: "No story available yet. Check back after 5 AM!" }, 404);
  }

  return json({ story });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
