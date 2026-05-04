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
  const readingLevel = seed.readingLevel || "default";
  let writingRules;

  if (readingLevel === "new-readers") {
    writingRules = [
      "CRITICAL WRITING RULES (New Readers — Kindergarten level):",
      "- Use ONLY very simple words (2-5 letters): go, run, see, big, red, dog, cat, mom, dad, fun, hop, sit, top, up, down, look, can, will, yes, no, stop, jump, play, sad, help, good, come, one, two, three.",
      "- Very short sentences: 3-7 words MAX.",
      "- Use repetitive, rhythmic patterns like Dr. Seuss: 'I see a dog. A big dog. A big, big dog!'",
      "- Write 30–60 words of scene text. Simple. Rhythmic. Fun to read aloud.",
      "- Each choice text must be under 8 words and use only simple words.",
      "- After 5–7 scenes, steer toward an ending. After 8 scenes, end the story."
    ];
  } else if (readingLevel === "early-elementary") {
    writingRules = [
      "WRITING RULES (1st & 2nd Grade — ages 6-8):",
      "- Use simple vocabulary. Short sentences (5-12 words).",
      "- Short paragraphs: 2-3 sentences per scene.",
      "- Write 40–80 words of scene text. Concrete, sensory, present tense.",
      "- Each choice text must be under 12 words and easy to read.",
      "- After 5–7 scenes, steer toward an ending. After 8 scenes, end the story."
    ];
  } else {
    writingRules = [
      "WRITING RULES:",
      "- Write 70–130 words of scene text. Concrete, sensory, present tense.",
      "- After 4–6 scenes, steer toward an ending. After 7 scenes, end the story."
    ];
  }

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
  return `Player's journey so far:\n\n${lines}\n\nGenerate the NEXT scene. The player is now living the consequence of their last choice.`;
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
