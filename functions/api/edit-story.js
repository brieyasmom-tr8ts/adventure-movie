// Cloudflare Pages Function — edit an existing Grandbabe story by free-text instruction
// Route: POST /api/edit-story
// Body:  { story: {...full story object}, instructions: "add a part where they meet a fox", author?: "Grandbabe" }
// Returns: { story: {...updated story object} }
//
// Claude is given the current story and the natural-language change request,
// and returns the full updated story preserving the same scene-id structure
// where possible. The {name} placeholder is preserved so the kids' name still
// gets substituted at play time.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "Story editing not configured" }, 503);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const story = body.story;
  const instructions = (body.instructions || "").trim();
  const author = (body.author || "").trim();

  if (!story || !story.scenes || !Array.isArray(story.scenes)) {
    return json({ error: "Missing or invalid story" }, 400);
  }
  if (!instructions) {
    return json({ error: "Tell me what you'd like to change" }, 400);
  }

  const systemPrompt = [
    "You are editing an existing children's choose-your-own-adventure story for a family member.",
    "You will be given the CURRENT story (as JSON) and a natural-language EDIT REQUEST.",
    "Apply the requested changes and return the FULL updated story as JSON — every scene, even the ones you didn't change.",
    "",
    "RULES:",
    "- Preserve scene IDs unless the request explicitly adds or removes scenes. When adding a new scene, give it a fresh id (e.g. s7, s4b) and make sure at least one existing scene's choices points to it.",
    "- Always preserve the literal placeholder \"{name}\" (with the curly braces) wherever the child protagonist is named. Do not replace it with an actual name.",
    author ? `If the author character \"${author}\" appears in the story, keep them in unless the edit asks to remove them.` : "",
    "- Always keep at least 3 endings (best, neutral, learning). Always keep 'ending' scenes flagged with ending:true.",
    "- Keep choices.nextScene values pointing to real scene IDs in the updated story.",
    "- Keep tone warm, age-appropriate, no violence, profanity, or scary content.",
    "- If the edit request is ambiguous, make a sensible interpretation and proceed.",
    "",
    "Return ONLY valid JSON with the same top-level shape as the input: { \"title\", \"theme\", \"emoji\", \"scenes\": [...] }. No prose around it."
  ].filter(Boolean).join("\n");

  const userPrompt = `CURRENT STORY:
${JSON.stringify({ title: story.title, theme: story.theme, emoji: story.emoji, scenes: story.scenes }, null, 2)}

EDIT REQUEST:
"${instructions}"

Return the FULL updated story JSON.`;

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
        max_tokens: 6144,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error(`Anthropic API ${resp.status}: ${detail}`);
      return json({ error: "Edit failed" }, 502);
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text;
    if (!text) return json({ error: "Empty response" }, 502);

    const updated = extractJson(text);
    if (!updated || !Array.isArray(updated.scenes) || !updated.scenes.length) {
      return json({ error: "Could not parse updated story" }, 502);
    }

    return json({ story: updated });
  } catch (e) {
    console.error(`Edit error: ${e.message}`);
    return json({ error: "Edit failed" }, 502);
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
