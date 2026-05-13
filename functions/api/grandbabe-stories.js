// Cloudflare Pages Function — Grandbabe's stories
// GET  /api/grandbabe-stories → list all stories
// POST /api/grandbabe-stories { ...story } → save a story
// DELETE /api/grandbabe-stories?id=xxx → delete a story

const KV_KEY = "grandbabe:stories";

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.STORIES_KV) return json({ stories: [] });

  const data = await env.STORIES_KV.get(KV_KEY, "json");
  return json({ stories: data || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "Storage not configured" }, 503);

  let story;
  try { story = await request.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!story.id || !story.title || !story.scenes) {
    return json({ error: "Invalid story data" }, 400);
  }

  const list = (await env.STORIES_KV.get(KV_KEY, "json")) || [];

  // Upsert: if a story with this id already exists, replace it. Otherwise
  // prepend the new one. This lets Grandbabe edit a story and have the
  // changes propagate to the kids' tray under the same id.
  const existingIndex = list.findIndex(s => s.id === story.id);
  if (existingIndex >= 0) {
    list[existingIndex] = story;
  } else {
    list.unshift(story);
    if (list.length > 20) list.length = 20;
  }

  await env.STORIES_KV.put(KV_KEY, JSON.stringify(list));
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "Storage not configured" }, 503);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);

  const list = (await env.STORIES_KV.get(KV_KEY, "json")) || [];
  const filtered = list.filter(s => s.id !== id);
  await env.STORIES_KV.put(KV_KEY, JSON.stringify(filtered));
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
