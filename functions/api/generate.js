// Cloudflare Pages Function — proxies scene generation to the Anthropic API.
// Route: POST /api/generate
// Required env var: ANTHROPIC_API_KEY (set in Cloudflare → Pages → Settings → Environment Variables)

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY is not set. Add it in Cloudflare Pages → Settings → Environment Variables and redeploy." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const seed = body && body.seed;
  const history = (body && body.history) || [];

  if (!seed || !seed.title || !seed.theme) {
    return json({ error: "Missing seed.title or seed.theme" }, 400);
  }
  if (!Array.isArray(history)) {
    return json({ error: "history must be an array" }, 400);
  }

  const systemPrompt = buildSystemPrompt(seed);
  const userPrompt = buildUserPrompt(history);

  let apiResp;
  try {
    apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });
  } catch (e) {
    return json({ error: "Network error reaching Anthropic", detail: String(e) }, 502);
  }

  if (!apiResp.ok) {
    const detail = await apiResp.text();
    return json({ error: `Anthropic API ${apiResp.status}`, detail }, 502);
  }

  let data;
  try {
    data = await apiResp.json();
  } catch (e) {
    return json({ error: "Anthropic returned non-JSON" }, 502);
  }

  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) {
    return json({ error: "Empty response from Anthropic" }, 502);
  }

  const scene = extractJson(text);
  if (!scene) {
    return json({ error: "Could not parse scene JSON", raw: text }, 502);
  }

  // Light validation + normalization
  if (scene.ending) {
    scene.ending = true;
    scene.type = scene.type || "Ending";
    scene.emoji = scene.emoji || "🎬";
    scene.title = scene.title || "The End";
    scene.text = scene.text || "";
    scene.lesson = scene.lesson || "";
    scene.reflect = Array.isArray(scene.reflect) ? scene.reflect.slice(0, 3) : [];
  } else {
    scene.chapter = scene.chapter || "";
    scene.text = scene.text || "";
    scene.mood = ["calm", "tension", "victory"].includes(scene.mood) ? scene.mood : "calm";
    scene.choices = Array.isArray(scene.choices) ? scene.choices.slice(0, 3) : [];
    scene.choices = scene.choices
      .filter(c => c && typeof c.text === "string" && c.text.trim())
      .map(c => ({ text: c.text.trim() }));
    if (scene.choices.length < 2) {
      // Fall back to a generic continuation rather than dead-ending the player
      scene.choices = [
        { text: "Press forward" },
        { text: "Pause and reconsider" }
      ];
    }
  }

  return json({ scene });
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

function buildSystemPrompt(seed) {
  // Canonical levels: L1 (Start Reading) … L4 (Story Master).
  // Accept legacy readingLevel values for backward compat.
  const legacyMap = {
    "new-readers": "L1",
    "early-elementary": "L2",
    "default": "L3"
  };
  const level = (seed.level && /^L[1-4]$/.test(seed.level))
    ? seed.level
    : (legacyMap[seed.readingLevel] || "L3");

  let writingRules;
  if (level === "L1") {
    writingRules = [
      "WRITING RULES — Level 1 · Start Reading (Pre-K / Kindergarten):",
      "- Use only very simple sight words (the, I, see, go, run, big, dog, cat, mom, dad, fun, up, down, look, can, will, yes, no, stop, jump, play, sad, help, good, come, one, two, three).",
      "- Very short sentences: 3–6 words each.",
      "- 1–2 sentences per scene. Use repetition: 'I see a dog. The dog runs.'",
      "- Include simple emotional words (happy, sad, scared) where useful.",
      "- Each choice text under 8 words, very simple words only.",
      "- Exactly 2 choices per scene.",
      "- Aim for 6–8 scenes total and 2–3 endings. After 6 scenes, steer toward an ending."
    ];
  } else if (level === "L2") {
    writingRules = [
      "WRITING RULES — Level 2 · Growing Reader (1st – 2nd Grade):",
      "- Simple sentences, 5–10 words each.",
      "- 2–3 sentences per scene. Common vocabulary with the occasional gentle stretch word.",
      "- Include simple dialogue occasionally; keep tone fun and slightly playful.",
      "- Choices clear but slightly more interesting (not always obvious).",
      "- 2–3 choices per scene.",
      "- Aim for 8–10 scenes total and 3–4 endings. After 8 scenes, steer toward an ending."
    ];
  } else if (level === "L3") {
    writingRules = [
      "WRITING RULES — Level 3 · Brave Reader (3rd – 4th Grade):",
      "- Clear, more developed sentences, 8–15 words each.",
      "- 3–5 sentences per scene. Include character thoughts and feelings ('You feel nervous but curious…').",
      "- Introduce mild tension, conflict, and realistic dialogue. Consequences should make sense.",
      "- Choices require thinking — avoid obvious right/wrong framing.",
      "- 2–3 choices per scene.",
      "- Aim for 10–12 scenes total and 4–5 endings. After 10 scenes, steer toward an ending."
    ];
  } else {
    writingRules = [
      "WRITING RULES — Level 4 · Story Master (5th – 6th Grade):",
      "- Varied sentence structure, 12–20 words. Richer vocabulary (still age-appropriate).",
      "- 4–6 sentences per scene. Internal conflict, layered decisions, consequences that unfold.",
      "- Immersive, thoughtful, slightly intense tone. Real moral decisions.",
      "- Choices complex with meaningful consequences.",
      "- 2–3 choices per scene.",
      "- Aim for 12–15 scenes total and 5–6 endings. After 12 scenes, steer toward an ending."
    ];
  }

  const playerLine = seed.playerName
    ? `- The protagonist is named "${seed.playerName}". Address them by name in the narration where natural (not in every sentence — sprinkle it in). Choices should still be written from their first-person perspective ("Climb the tree", not "${seed.playerName} climbs the tree").`
    : "";

  return [
    `You are the live story engine for an interactive choose-your-own-adventure app.`,
    "You generate ONE scene at a time, based on the player's full journey so far.",
    "",
    "STORY CONTEXT:",
    `- Title: ${seed.title}`,
    `- Theme: ${seed.theme}`,
    `- Category: ${seed.category || "General"}`,
    `- Tone: ${seed.tone || "cinematic, present-tense, emotionally honest"}`,
    `- Lesson the story moves toward: ${seed.lesson || "let the player discover meaning through their choices"}`,
    playerLine,
    "",
    ...writingRules,
    "",
    "GENERAL RULES:",
    "- Each scene offers 2 or 3 distinct, meaningful choices. Avoid obvious 'good vs evil' framing.",
    "- Each choice should genuinely diverge — different consequences, not just different words.",
    "- Age-appropriate: no graphic violence, no profanity, no sexual content.",
    "- Stay on theme. Do not drift into unrelated genres.",
    "- Never break the fourth wall. Never mention 'AI' or 'choose your own adventure' inside the scene.",
    "",
    "OUTPUT FORMAT — return ONLY a JSON object, no markdown fences, no commentary.",
    "",
    "For an in-progress scene:",
    '{ "chapter": "Short Title", "text": "scene text...", "mood": "calm" | "tension" | "victory", "ending": false, "choices": [ { "text": "..." }, { "text": "..." } ] }',
    "",
    "For an ending:",
    '{ "chapter": "Final Chapter", "ending": true, "type": "Best Ending" | "Neutral Ending" | "Learning Ending", "emoji": "🏆", "title": "Ending Title", "text": "60-100 words of ending text", "lesson": "one sentence life lesson", "reflect": ["question 1?", "question 2?", "question 3?"] }'
  ].join("\n");
}

function buildUserPrompt(history) {
  if (!history.length) {
    return "Begin the story. Generate the OPENING scene.";
  }
  const lines = history.map((h, i) => {
    const chap = h.chapter ? ` (${h.chapter})` : "";
    return `Scene ${i + 1}${chap}:\n${h.text}\n→ Player chose: "${h.choice}"`;
  }).join("\n\n");
  const sceneNum = history.length + 1;
  let endingInstruction = "";
  if (sceneNum >= 8) {
    endingInstruction = "\n\nIMPORTANT: This is scene " + sceneNum + ". The story has gone on long enough. You MUST generate an ENDING scene now (set ending:true). Wrap up the story based on the player's choices. Do NOT generate more choices.";
  } else if (sceneNum >= 5) {
    endingInstruction = "\n\nNote: This is scene " + sceneNum + ". Start steering toward a conclusion. The next 1-2 scenes should lead to an ending.";
  }
  return `Player's journey so far:\n\n${lines}\n\nGenerate the NEXT scene (scene ${sceneNum}). The player is now living the consequence of their last choice.${endingInstruction}`;
}

function extractJson(text) {
  // Try direct parse first.
  try { return JSON.parse(text); } catch (e) {}
  // Strip markdown fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (e) {}
  }
  // Last resort: find first { ... last }.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch (e) {}
  }
  return null;
}
