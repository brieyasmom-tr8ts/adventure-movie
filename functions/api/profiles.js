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

  if (!body.name || (!body.level && !body.ageGroup)) {
    return json({ error: "name and level (or ageGroup) are required" }, 400);
  }

  // Normalize level: prefer explicit level field, fall back to ageGroup mapping.
  const ageGroupToLevel = {
    "Start Reading": "L1",
    "Growing Reader": "L2",
    "Brave Reader": "L3",
    "Story Master": "L4",
    "New Readers": "L1",
    "1st & 2nd Grade": "L2",
    "3rd & 4th Grade": "L3",
    "4th & 5th Grade": "L3",
    "5th & 6th Grade": "L4"
  };
  const levelToAgeGroup = {
    L1: "Start Reading",
    L2: "Growing Reader",
    L3: "Brave Reader",
    L4: "Story Master"
  };
  let level = body.level && /^L[1-4]$/.test(body.level) ? body.level : null;
  if (!level) level = ageGroupToLevel[body.ageGroup] || "L2";
  const ageGroup = body.ageGroup || levelToAgeGroup[level];

  const id = body.id || crypto.randomUUID();
  const profile = {
    id,
    name: body.name,
    level,
    ageGroup,
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
