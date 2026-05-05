// Cloudflare Worker — runs daily at 5 AM UTC via cron trigger.
//
// Shared-plot daily story:
//   1. Generate ONE plot outline for today (title, theme, scene plan, choices).
//   2. Generate FOUR leveled narrations from that outline (L1 / L2 / L3 / L4).
//   3. For each registered profile, take the narration matching the kid's
//      level and generate per-scene images using their cartoon avatar
//      via fal.ai's instant-character model. Store the final personalized
//      story in KV under `story:<profileId>:<date>`.
//
// Required secrets:  ANTHROPIC_API_KEY, FAL_API_KEY
// Bindings:          STORIES_KV, IMAGES_R2

const LEVELS = ["L1", "L2", "L3", "L4"];
const LEVEL_NAMES = {
  L1: "Start Reading (Pre-K / Kindergarten)",
  L2: "Growing Reader (1st – 2nd Grade)",
  L3: "Brave Reader (3rd – 4th Grade)",
  L4: "Story Master (5th – 6th Grade)"
};

const FRUITS_OF_SPIRIT = [
  { fruit: "love",         theme: "choosing love over indifference" },
  { fruit: "joy",          theme: "finding joy in small wonders" },
  { fruit: "peace",        theme: "making peace where there is conflict" },
  { fruit: "patience",     theme: "learning patience when things are slow or hard" },
  { fruit: "kindness",     theme: "small acts of kindness that change someone's day" },
  { fruit: "goodness",     theme: "doing what is good even when it costs something" },
  { fruit: "faithfulness", theme: "staying faithful to a friend, a promise, or what is right" },
  { fruit: "gentleness",   theme: "being gentle with someone who is hurting or smaller" },
  { fruit: "self-control", theme: "choosing self-control over impulse" }
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateDailyStories(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/trigger" && request.method === "POST") {
      ctx.waitUntil(generateDailyStories(env));
      return json({ status: "generation started" });
    }
    return new Response("Daily story worker. POST /trigger to run manually.", { status: 200 });
  }
};

async function generateDailyStories(env) {
  const profiles = await getProfiles(env);
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Daily run for ${today} — ${profiles.length} profiles`);

  // Step 1: build one shared outline for today.
  const fruit = FRUITS_OF_SPIRIT[dayOfYear() % FRUITS_OF_SPIRIT.length];
  const outline = await generateOutline(env, fruit);
  if (!outline || !Array.isArray(outline.scenes)) {
    console.error("Outline generation failed; aborting daily run.");
    return;
  }
  await env.STORIES_KV.put(
    `outline:${today}`,
    JSON.stringify({ ...outline, fruit }),
    { expirationTtl: 60 * 60 * 72 }
  );

  // Step 2: generate one narration per level from the outline.
  const narrations = {};
  for (const level of LEVELS) {
    try {
      narrations[level] = await generateNarration(env, outline, fruit, level);
    } catch (e) {
      console.error(`Narration ${level} failed: ${e.message}`);
      narrations[level] = null;
    }
  }
  await env.STORIES_KV.put(
    `narrations:${today}`,
    JSON.stringify(narrations),
    { expirationTtl: 60 * 60 * 72 }
  );

  // Step 3: per profile — assemble their leveled narration + their avatar images.
  for (const profile of profiles) {
    try {
      const level = pickLevel(profile);
      const narration = narrations[level] || narrations.L2 || narrations.L3;
      if (!narration) {
        console.error(`No narration available for ${profile.name}, skipping.`);
        continue;
      }
      await assembleStoryForKid(env, profile, narration, today, fruit, level);
      console.log(`Done: ${profile.name} (${profile.id}) → ${level}`);
    } catch (e) {
      console.error(`Failed for ${profile.name}: ${e.message}`);
    }
  }
}

function pickLevel(profile) {
  if (profile.level && /^L[1-4]$/.test(profile.level)) return profile.level;
  const ag = profile.ageGroup;
  if (ag === "Start Reading" || ag === "New Readers") return "L1";
  if (ag === "Growing Reader" || ag === "1st & 2nd Grade") return "L2";
  if (ag === "Brave Reader" || ag === "3rd & 4th Grade") return "L3";
  if (ag === "Story Master" || ag === "5th & 6th Grade") return "L4";
  if (ag === "4th & 5th Grade") return "L3";
  return "L2";
}

async function getProfiles(env) {
  const list = await env.STORIES_KV.list({ prefix: "profile:" });
  const profiles = [];
  for (const key of list.keys) {
    const data = await env.STORIES_KV.get(key.name, "json");
    if (data) profiles.push(data);
  }
  return profiles;
}

// ----------------------------------------------------------------------------
// Outline generation — produces title, theme, fixed scene structure, choices.
// Same structure across all four levels (per spec: "same number of scenes
// and decision points, same outcomes, adapted to reading level").
// ----------------------------------------------------------------------------

async function generateOutline(env, fruit) {
  const SCENES = 8;
  const ENDINGS = 3;
  const system = [
    "You are designing the daily plot outline for a kids' choose-your-own-adventure app.",
    "Today's quiet undertone: Christian moral choice. The story should illuminate the fruit of the Spirit:",
    `${fruit.fruit} — ${fruit.theme}.`,
    "Do not preach, do not name the verse, do not break the fourth wall.",
    "",
    "OUTLINE STRUCTURE:",
    `- Exactly ${SCENES} branching scenes plus ${ENDINGS} endings (best, neutral, learning).`,
    "- Every non-ending scene has 2 or 3 choices that genuinely diverge.",
    "- Choices use \"nextScene\" as an index into the scenes array (or one of the ending IDs).",
    "- Each scene has an imagePrompt (10-20 words) describing what to draw — ONE child as the protagonist, with the rest of the scene around them.",
    "",
    "OUTPUT — return ONLY JSON, no fences:",
    `{
  "title": "Story title",
  "theme": "one phrase",
  "emoji": "one relevant emoji",
  "scenes": [
    { "id": "s1", "summary": "what happens here in 1-2 sentences", "imagePrompt": "...", "mood": "calm|tension|victory", "choices": [ {"text":"...", "nextScene":1}, {"text":"...", "nextScene":2} ], "ending": false },
    ...
    { "id": "ending_best", "summary": "...", "imagePrompt": "...", "type": "Best Ending", "emoji": "🏆", "title": "Ending title", "lesson": "one sentence", "reflect": ["q1?","q2?","q3?"], "ending": true },
    { "id": "ending_neutral", "summary": "...", "imagePrompt": "...", "type": "Neutral Ending", "emoji": "🌗", "title": "...", "lesson": "...", "reflect": ["..."], "ending": true },
    { "id": "ending_learn", "summary": "...", "imagePrompt": "...", "type": "Learning Ending", "emoji": "🌱", "title": "...", "lesson": "...", "reflect": ["..."], "ending": true }
  ]
}`,
    "",
    "Keep the outline reading-level neutral — narrative voice will be added per level later."
  ].join("\n");

  const text = await callAnthropic(env, system, "Generate today's plot outline.", 2048);
  return extractJson(text);
}

// ----------------------------------------------------------------------------
// Narration — same outline, one of four leveled voices.
// ----------------------------------------------------------------------------

function levelRules(level) {
  if (level === "L1") return [
    "Level 1 · Start Reading (Pre-K / Kindergarten):",
    "- Sight words only (the, I, see, go, run, big, dog, cat, mom, dad, up, down, look, yes, no, stop, jump, play, help, good, come).",
    "- 3-6 words per sentence. 1-2 sentences per scene.",
    "- Use repetition: 'I see a dog. The dog runs.' Pictures matter.",
    "- Each choice text under 8 words. Use only 2 choices per scene."
  ];
  if (level === "L2") return [
    "Level 2 · Growing Reader (1st – 2nd Grade):",
    "- 5-10 words per sentence. 2-3 sentences per scene.",
    "- Common vocabulary with occasional gentle stretch words.",
    "- Slightly silly/playful tone. Simple dialogue OK.",
    "- 2-3 choices per scene, each clear but mildly interesting."
  ];
  if (level === "L3") return [
    "Level 3 · Brave Reader (3rd – 4th Grade):",
    "- 8-15 words per sentence. 3-5 sentences per scene.",
    "- Internal thoughts and feelings ('You feel nervous but curious').",
    "- Mild tension, realistic dialogue, sensible consequences.",
    "- Choices require thinking — avoid obvious right/wrong framing."
  ];
  return [
    "Level 4 · Story Master (5th – 6th Grade):",
    "- 12-20 words per sentence. 4-6 sentences per scene.",
    "- Richer vocabulary (still age-appropriate). Layered decisions.",
    "- Internal conflict, immersive tone, consequences that unfold.",
    "- Choices complex with meaningful consequences."
  ];
}

async function generateNarration(env, outline, fruit, level) {
  const system = [
    `You write the ${LEVEL_NAMES[level]} narration of a daily kids' choose-your-own-adventure story.`,
    "Quiet undertone: Christian moral choice. Illuminate the fruit of the Spirit:",
    `${fruit.fruit} — ${fruit.theme}. Do not preach, do not name the verse.`,
    "",
    ...levelRules(level),
    "",
    "RULES:",
    "- Narrate every scene from the outline. Same plot, same choices, same outcomes — only voice and reading level change.",
    "- Preserve every scene id and choice nextScene mapping exactly.",
    "- Keep the imagePrompt the same as in the outline (it's used downstream for image generation).",
    "",
    "OUTPUT — return ONLY JSON of the same shape as the outline, but each non-ending scene has a `chapter` (short title) and `text` (narrated body), and each ending has `text` (60-100 words at L3/L4, shorter at L1/L2)."
  ].join("\n");

  const user = `OUTLINE:\n${JSON.stringify(outline)}\n\nReturn the narrated story JSON.`;
  const text = await callAnthropic(env, system, user, 4096);
  const narrated = extractJson(text);
  if (!narrated) throw new Error("Narration JSON parse failed");
  return narrated;
}

// ----------------------------------------------------------------------------
// Per-kid assembly — clones the level narration, generates avatar images,
// stores the personalized story in KV.
// ----------------------------------------------------------------------------

async function assembleStoryForKid(env, profile, narration, today, fruit, level) {
  // Deep-clone so we don't mutate the shared narration object across profiles.
  const story = JSON.parse(JSON.stringify(narration));

  const scenes = Array.isArray(story.scenes) ? story.scenes : [];
  const imageJobs = scenes.map((scene, i) =>
    generateSceneImage(env, profile, scene, i)
  );
  const images = await Promise.all(imageJobs);

  for (let i = 0; i < scenes.length; i++) {
    if (images[i]) {
      const key = `${profile.id}/${today}/scene-${i}.png`;
      await env.IMAGES_R2.put(key, images[i], {
        httpMetadata: { contentType: "image/png" }
      });
      scenes[i].image = `/api/daily-image/${key}`;
    }
  }

  const storyData = {
    id: `${profile.id}-${today}`,
    date: today,
    profileId: profile.id,
    playerName: profile.name,
    level,
    ageGroup: profile.ageGroup,
    fruit: fruit.fruit,
    ...story
  };

  await env.STORIES_KV.put(
    `story:${profile.id}:${today}`,
    JSON.stringify(storyData),
    { expirationTtl: 60 * 60 * 72 }
  );
  await env.STORIES_KV.put(
    `story:${profile.id}:latest`,
    JSON.stringify(storyData),
    { expirationTtl: 60 * 60 * 72 }
  );
}

async function generateSceneImage(env, profile, scene, index) {
  if (!env.FAL_API_KEY) return null;
  if (!scene.imagePrompt) return null;
  const referenceImageUrl = profile.avatarUrl;
  if (!referenceImageUrl) return null;

  const prompt = `Children's storybook illustration. ${scene.imagePrompt}. The main character is a child named ${profile.name}. Friendly, colorful, warm lighting, safe for children.`;

  try {
    const submitResp = await fetch(`https://queue.fal.run/${env.FAL_MODEL || "fal-ai/instant-character"}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${env.FAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        image_url: referenceImageUrl,
        num_images: 1,
        image_size: "landscape_16_9",
        output_format: "png"
      })
    });
    if (!submitResp.ok) {
      console.error(`fal.ai error scene ${index}: ${await submitResp.text()}`);
      return null;
    }
    const result = await submitResp.json();
    const imageUrl = result?.images?.[0]?.url || result?.image?.url;
    if (!imageUrl) return null;
    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) return null;
    return await imageResp.arrayBuffer();
  } catch (e) {
    console.error(`Image gen failed scene ${index}: ${e.message}`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Anthropic helper + utilities
// ----------------------------------------------------------------------------

async function callAnthropic(env, system, user, maxTokens) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error("Empty Anthropic response");
  return text;
}

function dayOfYear() {
  const d = new Date();
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}

function extractJson(text) {
  try { return JSON.parse(text); } catch (e) {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (e) {}
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch (e) {}
  }
  return null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
