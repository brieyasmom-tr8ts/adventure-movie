// Cloudflare Pages Function — CRUD for kid profiles
// Route: GET/POST/DELETE /api/profiles
// Binding: STORIES_KV (KV namespace)

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  const list = await env.STORIES_KV.list({ prefix: "profile:" });
  const profiles = [];
  for (const key of list.keys) {
    const data = await env.STORIES_KV.get(key.name, "json");
    if (data) profiles.push(data);
  }
  return json({ profiles });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.name || !body.ageGroup) {
    return json({ error: "name and ageGroup are required" }, 400);
  }

  const id = body.id || crypto.randomUUID();
  const profile = {
    id,
    name: body.name,
    ageGroup: body.ageGroup, // "New Readers", "1st & 2nd Grade", "4th & 5th Grade"
    avatarUrl: body.avatarUrl || null, // URL to their cartoon avatar in R2
    avatarStyle: body.avatarStyle || "pixar",
    createdAt: new Date().toISOString()
  };

  await env.STORIES_KV.put(`profile:${id}`, JSON.stringify(profile));
  return json({ profile });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id param required" }, 400);

  await env.STORIES_KV.delete(`profile:${id}`);
  return json({ deleted: id });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
