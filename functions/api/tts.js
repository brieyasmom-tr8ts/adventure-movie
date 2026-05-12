// Cloudflare Pages Function — text-to-speech via OpenAI TTS API
// Route: POST /api/tts   body: { text: "..." }
// Returns audio/mpeg stream

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "TTS not configured" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const text = (body.text || "").trim();
  if (!text || text.length > 4096) {
    return new Response(JSON.stringify({ error: "text required (max 4096 chars)" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  try {
    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "shimmer",
        input: text,
        response_format: "mp3",
        speed: 0.95
      })
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error(`OpenAI TTS error ${resp.status}: ${detail}`);
      return new Response(JSON.stringify({ error: "TTS generation failed" }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(resp.body, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "private, max-age=3600"
      }
    });
  } catch (e) {
    console.error(`TTS fetch error: ${e.message}`);
    return new Response(JSON.stringify({ error: "TTS request failed" }), {
      status: 502,
      headers: { "content-type": "application/json" }
    });
  }
}
