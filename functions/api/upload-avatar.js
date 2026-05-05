// Cloudflare Pages Function — stores a cartoon avatar in R2 and returns its public URL
// Route: POST /api/upload-avatar  (JSON with { profileId, dataUrl })
// Binding: IMAGES_R2

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.IMAGES_R2) return json({ error: "IMAGES_R2 not bound" }, 500);

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { profileId, dataUrl } = body || {};
  if (!profileId || !dataUrl) {
    return json({ error: "profileId and dataUrl are required" }, 400);
  }

  // Convert data URL to binary
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) {
    return json({ error: "Invalid data URL format" }, 400);
  }

  const contentType = `image/${match[1]}`;
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));

  const key = `avatars/${profileId}.${ext}`;
  await env.IMAGES_R2.put(key, bytes, {
    httpMetadata: { contentType }
  });

  // Return the URL path that daily-image handler can serve
  const url = `/api/daily-image/${key}`;
  return json({ url });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
