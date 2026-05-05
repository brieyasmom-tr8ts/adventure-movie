// Cloudflare Worker — runs daily at 5 AM UTC via cron trigger.
// Generates personalized stories + images for each registered kid.
//
// Required env vars (secrets):
//   ANTHROPIC_API_KEY — for Claude story generation
//   FAL_API_KEY       — for fal.ai image generation
//
// Bindings:
//   STORIES_KV — KV namespace for profiles + generated stories
//   IMAGES_R2  — R2 bucket for scene images

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateDailyStories(env));
  },

  // Also allow manual trigger via HTTP (for testing)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/trigger" && request.method === "POST") {
      ctx.waitUntil(generateDailyStories(env));
      return new Response(JSON.stringify({ status: "generation started" }), {
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("Daily story worker. POST /trigger to run manually.", { status: 200 });
  }
};

async function generateDailyStories(env) {
  const profiles = await getProfiles(env);
  if (!profiles.length) {
    console.log("No profiles found, skipping generation.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log(`Generating stories for ${profiles.length} kids on ${today}`);

  for (const profile of profiles) {
    try {
      await generateStoryForKid(env, profile, today);
      console.log(`Done: ${profile.name} (${profile.id})`);
    } catch (e) {
      console.error(`Failed for ${profile.name}: ${e.message}`);
    }
  }
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

// --- Story Generation ---

async function generateStoryForKid(env, profile, today) {
  const scenesCount = parseInt(env.SCENES_PER_STORY || "8", 10);
  const seed = buildStorySeed(profile);

  // Generate the full story (all scenes at once for pre-generation)
  const story = await generateFullStory(env, seed, scenesCount);
  if (!story || !story.scenes || !story.scenes.length) {
    throw new Error("Empty story returned from Claude");
  }

  // Generate images for each scene using fal.ai with kid's face
  const imagePromises = story.scenes.map((scene, i) =>
    generateSceneImage(env, profile, scene, i)
  );
  const images = await Promise.all(imagePromises);

  // Store images in R2 and update scene URLs
  for (let i = 0; i < story.scenes.length; i++) {
    if (images[i]) {
      const key = `${profile.id}/${today}/scene-${i}.png`;
      await env.IMAGES_R2.put(key, images[i], {
        httpMetadata: { contentType: "image/png" }
      });
      story.scenes[i].image = `/api/daily-image/${key}`;
    }
  }

  // Store the completed story in KV
  const storyData = {
    id: `${profile.id}-${today}`,
    date: today,
    profileId: profile.id,
    playerName: profile.name,
    ageGroup: profile.ageGroup,
    ...story
  };

  await env.STORIES_KV.put(
    `story:${profile.id}:${today}`,
    JSON.stringify(storyData),
    { expirationTtl: 60 * 60 * 72 } // Keep for 3 days
  );

  // Also store as "latest" for easy lookup
  await env.STORIES_KV.put(
    `story:${profile.id}:latest`,
    JSON.stringify(storyData),
    { expirationTtl: 60 * 60 * 72 }
  );
}

function buildStorySeed(profile) {
  const themes = {
    "New Readers": [
      { title: "The Magic Pet", theme: "Kindness", tone: "very simple words, short sentences, rhyming, kindergarten level" },
      { title: "The Lost Star", theme: "Being Brave", tone: "very simple words, short sentences, rhyming, kindergarten level" },
      { title: "The Rainy Day", theme: "Helping Others", tone: "very simple words, short sentences, rhyming, kindergarten level" },
      { title: "The Big Race", theme: "Trying Hard", tone: "very simple words, short sentences, rhyming, kindergarten level" },
      { title: "The New Friend", theme: "Sharing", tone: "very simple words, short sentences, rhyming, kindergarten level" }
    ],
    "1st & 2nd Grade": [
      { title: "The Treasure Map", theme: "Teamwork", tone: "simple vocabulary, short paragraphs, ages 6-8, adventure" },
      { title: "The Robot Helper", theme: "Responsibility", tone: "simple vocabulary, short paragraphs, ages 6-8, fun" },
      { title: "The Snow Day Surprise", theme: "Generosity", tone: "simple vocabulary, short paragraphs, ages 6-8, cozy" },
      { title: "The Secret Garden Door", theme: "Curiosity", tone: "simple vocabulary, short paragraphs, ages 6-8, wonder" },
      { title: "The Missing Homework", theme: "Honesty", tone: "simple vocabulary, short paragraphs, ages 6-8, relatable" }
    ],
    "4th & 5th Grade": [
      { title: "The Impossible Goal", theme: "Perseverance", tone: "vivid, present-tense, ages 9-11, emotionally real" },
      { title: "The Secret Message", theme: "Trust", tone: "mysterious, present-tense, ages 9-11, suspenseful" },
      { title: "The Election", theme: "Integrity", tone: "school drama, present-tense, ages 9-11, thoughtful" },
      { title: "The Rescue Mission", theme: "Sacrifice", tone: "adventure, present-tense, ages 9-11, exciting" },
      { title: "The Inventor's Challenge", theme: "Creativity", tone: "inspiring, present-tense, ages 9-11, imaginative" }
    ]
  };

  const group = profile.ageGroup || "4th & 5th Grade";
  const options = themes[group] || themes["4th & 5th Grade"];
  const pick = options[Math.floor(Math.random() * options.length)];

  return {
    ...pick,
    category: group,
    playerName: profile.name,
    readingLevel: group === "New Readers" ? "new-readers" : group === "1st & 2nd Grade" ? "early-elementary" : "default",
    lesson: "let the story discover its own meaning through the player's choices"
  };
}

async function generateFullStory(env, seed, scenesCount) {
  const systemPrompt = buildSystemPrompt(seed, scenesCount);
  const userPrompt = `Generate a complete ${scenesCount}-scene branching story. Return it as a JSON object with this structure:
{
  "title": "Story Title",
  "theme": "${seed.theme}",
  "emoji": "relevant emoji",
  "scenes": [
    {
      "id": "s1",
      "chapter": "Chapter Title",
      "text": "scene narration...",
      "mood": "calm|tension|victory",
      "imagePrompt": "short visual description of this scene for image generation",
      "choices": [
        { "text": "choice text", "nextScene": 1 },
        { "text": "choice text", "nextScene": 2 }
      ],
      "ending": false
    },
    ...more scenes...,
    {
      "id": "ending_best",
      "chapter": "Final Chapter",
      "ending": true,
      "type": "Best Ending",
      "emoji": "trophy emoji",
      "title": "Ending Title",
      "text": "ending narration...",
      "imagePrompt": "visual description",
      "lesson": "one sentence life lesson",
      "reflect": ["question 1?", "question 2?", "question 3?"]
    }
  ]
}

Include at least 5 branching choice scenes and 3 endings (best, neutral, learning). Choices use "nextScene" as an index into the scenes array. Return ONLY valid JSON.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${detail}`);
  }

  const data = await resp.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error("Empty response from Anthropic");

  return extractJson(text);
}

function buildSystemPrompt(seed, scenesCount) {
  let writingRules;
  if (seed.readingLevel === "new-readers") {
    writingRules = "Use ONLY very simple 2-5 letter words. Sentences of 3-7 words MAX. Repetitive, rhyming patterns like Dr. Seuss. 30-60 words per scene.";
  } else if (seed.readingLevel === "early-elementary") {
    writingRules = "Simple vocabulary, short sentences (5-12 words). 2-3 sentences per scene. 40-80 words per scene.";
  } else {
    writingRules = "Write 70-130 words per scene. Vivid, sensory, present tense.";
  }

  const playerLine = seed.playerName
    ? `The protagonist is named "${seed.playerName}". Use their name naturally in narration.`
    : "";

  return [
    "You are a story generator for a children's choose-your-own-adventure app.",
    `Story: "${seed.title}" | Theme: ${seed.theme} | Category: ${seed.category}`,
    `Tone: ${seed.tone}`,
    playerLine,
    writingRules,
    `Generate a complete branching story with ${scenesCount} total scenes including 3 endings.`,
    "Each non-ending scene must include an imagePrompt field: a short (10-20 word) visual description of the scene suitable for AI image generation. Describe the setting, action, and mood visually.",
    "Make choices genuinely diverge. Age-appropriate: no violence, profanity, or sexual content.",
    "Return ONLY a valid JSON object."
  ].filter(Boolean).join("\n");
}

// --- Image Generation (fal.ai) ---

async function generateSceneImage(env, profile, scene, index) {
  if (!env.FAL_API_KEY) return null;
  if (!scene.imagePrompt) return null;

  const referenceImageUrl = profile.avatarUrl;
  if (!referenceImageUrl) {
    // No reference photo — skip personalized image
    return null;
  }

  const prompt = `Children's storybook illustration. ${scene.imagePrompt}. The main character is a child named ${profile.name}. Friendly, colorful, warm lighting, safe for children.`;

  try {
    // Submit job to fal.ai
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
      const err = await submitResp.text();
      console.error(`fal.ai error for scene ${index}: ${err}`);
      return null;
    }

    const result = await submitResp.json();

    // fal.ai queue returns the image URL directly or in images array
    const imageUrl = result?.images?.[0]?.url || result?.image?.url;
    if (!imageUrl) {
      console.error(`No image URL in fal.ai response for scene ${index}`);
      return null;
    }

    // Download the image bytes to store in R2
    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) return null;
    return await imageResp.arrayBuffer();
  } catch (e) {
    console.error(`Image generation failed for scene ${index}: ${e.message}`);
    return null;
  }
}

// --- Utilities ---

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
