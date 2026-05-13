// Cloudflare Pages Function — generate a playable branching story from a simple outline
// Route: POST /api/story-editor
// Body: { title, plot, lesson, level }
// Returns: { story: { title, theme, emoji, scenes: [...] } }

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "Story generation not configured" }, 503);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const title = (body.title || "").trim();
  const plot = (body.plot || "").trim();
  const level = body.level || "L2";
  const lesson = (body.lesson || "").trim();

  if (!title || !plot) {
    return json({ error: "Title and plot are required" }, 400);
  }

  const writingRules = {
    L1: "Use ONLY very simple 2-5 letter words. Sentences of 3-7 words MAX. 30-60 words per scene.",
    L2: "Simple vocabulary, short sentences (5-12 words). 2-3 sentences per scene. 40-80 words per scene.",
    L3: "Clear vocabulary, moderate sentences. 3-4 sentences per scene. 60-100 words per scene.",
    L4: "Vivid, sensory, present tense. 70-130 words per scene."
  }[level] || "Simple vocabulary, short sentences. 40-80 words per scene.";

  const systemPrompt = [
    "You are a story generator for a children's choose-your-own-adventure reading app.",
    "A family member has written a simple story idea. Turn it into a complete branching story.",
    `Writing rules: ${writingRules}`,
    "Make it warm, age-appropriate, and fun. No violence, profanity, or scary content.",
    lesson ? `The story should teach this lesson: ${lesson}` : "Let the story discover its own gentle lesson.",
    "Return ONLY valid JSON."
  ].join("\n");

  const userPrompt = `Turn this story idea into a playable branching adventure:

Title: "${title}"
Plot: "${plot}"
${lesson ? `Lesson: "${lesson}"` : ""}

Generate a JSON object with this exact structure:
{
  "title": "${title}",
  "theme": "one-word theme",
  "emoji": "relevant emoji",
  "scenes": [
    {
      "id": "s1",
      "chapter": "Chapter Title",
      "text": "scene narration...",
      "mood": "calm",
      "choices": [
        { "text": "choice text", "nextScene": "s2a" },
        { "text": "choice text", "nextScene": "s2b" }
      ]
    },
    ...more branching scenes with id like s2a, s2b, s3a etc...,
    {
      "id": "ending_best",
      "ending": true,
      "type": "Best Ending",
      "emoji": "trophy emoji",
      "title": "Ending Title",
      "text": "ending narration...",
      "lesson": "one sentence lesson",
      "reflect": ["question 1?", "question 2?", "question 3?"]
    },
    {
      "id": "ending_neutral",
      "ending": true,
      "type": "Neutral Ending",
      "emoji": "thinking emoji",
      "title": "Ending Title",
      "text": "ending narration...",
      "lesson": "one sentence lesson",
      "reflect": ["question 1?", "question 2?"]
    },
    {
      "id": "ending_learn",
      "ending": true,
      "type": "Learning Ending",
      "emoji": "lightbulb emoji",
      "title": "Ending Title",
      "text": "ending narration...",
      "lesson": "one sentence lesson",
      "reflect": ["question 1?", "question 2?"]
    }
  ]
}

Include 5-6 branching choice scenes and exactly 3 endings (best, neutral, learning).
Choices use "nextScene" as the id of the next scene.
Start with scene id "s1". Return ONLY valid JSON.`;

  try {
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
      console.error(`Anthropic API ${resp.status}: ${detail}`);
      return json({ error: "Story generation failed" }, 502);
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text;
    if (!text) return json({ error: "Empty response" }, 502);

    const story = extractJson(text);
    if (!story || !story.scenes) {
      return json({ error: "Could not parse story" }, 502);
    }

    return json({ story });
  } catch (e) {
    console.error(`Story editor error: ${e.message}`);
    return json({ error: "Generation failed" }, 502);
  }
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
