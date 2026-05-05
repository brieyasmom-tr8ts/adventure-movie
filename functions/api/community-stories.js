// Cloudflare Pages Function — community-shared AI Adventures.
// When a kid finishes an AI Adventure, the journey is auto-saved here so
// other kids can replay it without burning fresh Anthropic tokens.
//
// Routes:
//   GET    /api/community-stories            → recent shared stories (summary)
//   GET    /api/community-stories?id=<id>    → full story (scenes + ending)
//   POST   /api/community-stories            → share a finished journey
//   DELETE /api/community-stories?id=<id>    → admin remove (Bearer ADMIN_TOKEN)
//
// Bindings: STORIES_KV
// Env (optional): ADMIN_TOKEN (required for DELETE; if unset, DELETE 503s)

const INDEX_KEY = "community:_index";
const MAX_INDEX = 200;

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const data = await env.STORIES_KV.get(`community:${id}`, "json");
    if (!data) return json({ error: "Not found" }, 404);
    return json({ story: data });
  }

  const index = (await env.STORIES_KV.get(INDEX_KEY, "json")) || [];
  return json({ stories: index });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ error: "Invalid JSON" }, 400);
  }

  const {
    storyId, title, theme, image, emoji, level, fruit, originName,
    scenes, ending
  } = body || {};

  if (!storyId || !title || !Array.isArray(scenes) || scenes.length === 0 || !ending) {
    return json({ error: "storyId, title, scenes[], and ending are required" }, 400);
  }
  if (!ending.title || !ending.text) {
    return json({ error: "ending.title and ending.text are required" }, 400);
  }

  const pathHash = await sha1(storyId + "|" + scenes.map(s => s.choice || "").join(">"));

  // Dedupe — if this exact path was already shared, return the existing entry.
  const index = (await env.STORIES_KV.get(INDEX_KEY, "json")) || [];
  const existing = index.find(e => e.pathHash === pathHash);
  if (existing) {
    existing.replayCount = (existing.replayCount || 1) + 1;
    await env.STORIES_KV.put(INDEX_KEY, JSON.stringify(index));
    return json({ id: existing.id, deduped: true });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const safeName = (originName || "Anonymous").toString().slice(0, 24);

  const full = {
    id, storyId, title, theme: theme || "",
    image: image || "", emoji: emoji || "✨",
    level: level || "L3", fruit: fruit || "",
    originName: safeName, pathHash,
    scenes: scenes.map(s => ({
      chapter: (s.chapter || "").toString().slice(0, 80),
      text: (s.text || "").toString().slice(0, 4000),
      choice: (s.choice || "").toString().slice(0, 200)
    })),
    ending: {
      type: (ending.type || "Ending").toString().slice(0, 32),
      emoji: (ending.emoji || "🎬").toString().slice(0, 8),
      title: ending.title.toString().slice(0, 120),
      text: ending.text.toString().slice(0, 2000),
      lesson: (ending.lesson || "").toString().slice(0, 400),
      reflect: Array.isArray(ending.reflect) ? ending.reflect.slice(0, 3).map(q => q.toString().slice(0, 200)) : []
    },
    createdAt,
    replayCount: 1
  };

  await env.STORIES_KV.put(`community:${id}`, JSON.stringify(full));

  const summary = {
    id, storyId, title, theme: full.theme,
    image: full.image, emoji: full.emoji,
    originName: safeName, level: full.level,
    sceneCount: full.scenes.length,
    createdAt, replayCount: 1
  };
  index.unshift(summary);
  if (index.length > MAX_INDEX) index.length = MAX_INDEX;
  await env.STORIES_KV.put(INDEX_KEY, JSON.stringify(index));

  return json({ id, summary });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);
  if (!env.ADMIN_TOKEN) {
    return json({ error: "ADMIN_TOKEN not configured. Set it in Cloudflare Pages env vars to enable deletes." }, 503);
  }
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id param required" }, 400);

  await env.STORIES_KV.delete(`community:${id}`);
  const index = (await env.STORIES_KV.get(INDEX_KEY, "json")) || [];
  const next = index.filter(e => e.id !== id);
  await env.STORIES_KV.put(INDEX_KEY, JSON.stringify(next));

  return json({ deleted: id });
}

async function sha1(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
