// Cloudflare Pages Function — serves pre-generated scene images from R2
// Route: GET /api/daily-image/:profileId/:date/scene-:n.png
// Binding: IMAGES_R2

export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.IMAGES_R2) {
    return new Response("IMAGES_R2 not bound", { status: 500 });
  }

  const key = params.path.join("/");
  const object = await env.IMAGES_R2.get(key);

  if (!object) {
    return new Response("Image not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "image/png",
      "cache-control": "public, max-age=86400" // Cache for 1 day
    }
  });
}
