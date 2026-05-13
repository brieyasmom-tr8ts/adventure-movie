// Cloudflare Pages Function — Family code system
// Routes:
//   POST /api/family  { action: "create" }           → create family, return code
//   POST /api/family  { action: "join", code: "..." } → join family, return data
//   POST /api/family  { action: "sync", code: "...", data: {...} } → upload+download merged data
//   POST /api/family  { action: "info", code: "..." } → get family info without syncing
// Binding: STORIES_KV

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STORIES_KV) return json({ error: "STORIES_KV not bound" }, 500);

  let body;
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = body.action;
  if (!action) return json({ error: "action required" }, 400);

  switch (action) {
    case "create": return handleCreate(env, body);
    case "join":   return handleJoin(env, body);
    case "sync":   return handleSync(env, body);
    case "info":   return handleInfo(env, body);
    case "rename": return handleRename(env, body);
    default:       return json({ error: "Unknown action" }, 400);
  }
}

// --- Create a new family ---
async function handleCreate(env, body) {
  const code = generateCode();
  const now = new Date().toISOString();

  const family = {
    code,
    createdAt: now,
    updatedAt: now,
    data: body.data || {}
  };

  await env.STORIES_KV.put(`family:${code}`, JSON.stringify(family));
  return json({ code, family });
}

// --- Join an existing family ---
async function handleJoin(env, body) {
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "code required" }, 400);

  const family = await env.STORIES_KV.get(`family:${code}`, "json");
  if (!family) return json({ error: "Family not found. Check the code and try again." }, 404);

  return json({ code: family.code, data: family.data || {} });
}

// --- Sync family data (merge local + server) ---
async function handleSync(env, body) {
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "code required" }, 400);

  const family = await env.STORIES_KV.get(`family:${code}`, "json");
  if (!family) return json({ error: "Family not found" }, 404);

  const localData = body.data || {};
  const serverData = family.data || {};

  // Merge: combine players, per-player data uses latest
  const merged = mergeData(serverData, localData);

  family.data = merged;
  family.updatedAt = new Date().toISOString();

  await env.STORIES_KV.put(`family:${code}`, JSON.stringify(family));

  return json({ code: family.code, data: merged });
}

// --- Get family info ---
async function handleInfo(env, body) {
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "code required" }, 400);

  const family = await env.STORIES_KV.get(`family:${code}`, "json");
  if (!family) return json({ error: "Family not found" }, 404);

  return json({
    code: family.code,
    createdAt: family.createdAt,
    playerCount: (family.data && family.data.players) ? family.data.players.length : 0
  });
}

// --- Merge logic ---
function mergeData(server, local) {
  const merged = {};

  // Merge player lists (union by name)
  const serverPlayers = server.players || [];
  const localPlayers = local.players || [];
  const allNames = [...new Set([...serverPlayers, ...localPlayers])];
  merged.players = allNames;

  // Merge avatars (local wins on conflict — user just took a new photo)
  merged.avatars = { ...(server.avatars || {}), ...(local.avatars || {}) };

  // Merge levels (local wins)
  merged.levels = { ...(server.levels || {}), ...(local.levels || {}) };

  // Merge age groups (local wins)
  merged.ageGroups = { ...(server.ageGroups || {}), ...(local.ageGroups || {}) };

  // Per-player data: progress, xp, badges, streak, traits
  for (const name of allNames) {
    // Progress — merge endings lists per story
    const sp = server[`progress_${name}`] || {};
    const lp = local[`progress_${name}`] || {};
    const mp = {};
    for (const storyId of new Set([...Object.keys(sp), ...Object.keys(lp)])) {
      const se = (sp[storyId] && sp[storyId].endings) || [];
      const le = (lp[storyId] && lp[storyId].endings) || [];
      mp[storyId] = { endings: [...new Set([...se, ...le])] };
    }
    merged[`progress_${name}`] = mp;

    // XP — take the higher value
    const sx = server[`xp_${name}`] || { xp: 0, level: 1, history: [] };
    const lx = local[`xp_${name}`] || { xp: 0, level: 1, history: [] };
    merged[`xp_${name}`] = (lx.xp || 0) >= (sx.xp || 0) ? lx : sx;

    // Badges — union
    const sb = server[`badges_${name}`] || [];
    const lb = local[`badges_${name}`] || [];
    merged[`badges_${name}`] = [...new Set([...sb, ...lb])];

    // Streak — take the higher count
    const ss = server[`streak_${name}`] || {};
    const ls = local[`streak_${name}`] || {};
    merged[`streak_${name}`] = (ls.count || 0) >= (ss.count || 0) ? ls : ss;

    // Traits — merge, higher values win
    const st = server[`traits_${name}`] || {};
    const lt = local[`traits_${name}`] || {};
    const mt = { ...st };
    for (const [k, v] of Object.entries(lt)) {
      mt[k] = Math.max(mt[k] || 0, v || 0);
    }
    merged[`traits_${name}`] = mt;
  }

  return merged;
}

// --- Rename family code ---
async function handleRename(env, body) {
  const oldCode = normalizeCode(body.code);
  if (!oldCode) return json({ error: "current code required" }, 400);

  const newCode = normalizeCode(body.newCode);
  if (!newCode) return json({ error: "new code required" }, 400);
  if (!isValidCode(newCode)) return json({ error: "Code must be 4-8 characters: letters, numbers, or hyphens" }, 400);

  const family = await env.STORIES_KV.get(`family:${oldCode}`, "json");
  if (!family) return json({ error: "Family not found" }, 404);

  // Check new code isn't taken
  const existing = await env.STORIES_KV.get(`family:${newCode}`, "json");
  if (existing) return json({ error: "That code is already taken. Try another!" }, 409);

  // Move to new key
  family.code = newCode;
  family.updatedAt = new Date().toISOString();
  await env.STORIES_KV.put(`family:${newCode}`, JSON.stringify(family));
  await env.STORIES_KV.delete(`family:${oldCode}`);

  return json({ code: newCode });
}

// --- Code generation: random 6-digit number ---
function generateCode() {
  const len = 6;
  let code = "";
  for (let i = 0; i < len; i++) code += Math.floor(Math.random() * 10);
  return code;
}

function isValidCode(code) {
  return /^[a-z0-9-]{4,8}$/i.test(code);
}

function normalizeCode(code) {
  if (!code || typeof code !== "string") return null;
  return code.trim().toLowerCase();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}
