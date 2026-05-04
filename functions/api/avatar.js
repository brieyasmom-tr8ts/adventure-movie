// Cloudflare Pages Function — converts a kid's selfie into a friendly cartoon
// portrait via the OpenAI image edits API. We never store the original photo;
// only the cartoon b64 returned to the client (which keeps it in localStorage).
//
// Route: POST /api/avatar  (multipart form-data with 'image' file)
// Required env var: OPENAI_API_KEY (set in Cloudflare → Pages → Settings → Environment Variables)

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY is not set. Add it in Cloudflare Pages → Settings → Environment Variables and redeploy." }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return json({ error: "Invalid form data" }, 400);
  }

  const file = formData.get("image");
  if (!file || typeof file === "string") {
    return json({ error: "Missing image file" }, 400);
  }

  // Hard-cap upload size to avoid eating worker memory or burning API tokens.
  if (file.size && file.size > 8 * 1024 * 1024) {
    return json({ error: "Image too large (max 8 MB)" }, 413);
  }

  const style = (formData.get("style") || "pixar").toString().toLowerCase();
  const styleMap = {
    pixar: "Pixar-style 3D cartoon, soft warm lighting, friendly proportions",
    anime: "anime style, expressive eyes, clean line art, vibrant colors",
    watercolor: "watercolor illustration, soft brushstrokes, gentle pastel palette",
    lego: "Lego minifigure style, blocky, friendly"
  };
  const styleDesc = styleMap[style] || styleMap.pixar;

  const prompt = [
    "Convert this photo of a child into a friendly cartoon portrait suitable for a children's storybook.",
    `Style: ${styleDesc}.`,
    "Head-and-shoulders, neutral light background, wholesome and joyful.",
    "Preserve the child's hairstyle, skin tone, and any glasses, but stylize as a cartoon character.",
    "No text, no logos, no extra characters."
  ].join(" ");

  const upstream = new FormData();
  upstream.append("model", "gpt-image-1");
  upstream.append("image", file);
  upstream.append("prompt", prompt);
  upstream.append("n", "1");
  upstream.append("size", "512x512");

  let resp;
  try {
    resp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: upstream
    });
  } catch (e) {
    return json({ error: "Network error reaching OpenAI", detail: String(e) }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text();
    return json({ error: `OpenAI ${resp.status}`, detail }, 502);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return json({ error: "OpenAI returned non-JSON" }, 502);
  }

  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    return json({ error: "No image returned" }, 502);
  }

  return json({ dataUrl: `data:image/png;base64,${b64}` });
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
