#!/bin/bash
# Setup script for the daily story cron worker
# Run this once to create KV namespace and R2 bucket

echo "=== Creating KV namespace ==="
npx wrangler kv namespace create STORIES_KV
echo ""
echo "Copy the 'id' from above into:"
echo "  1. workers/daily-story/wrangler.toml (kv_namespaces id)"
echo "  2. Cloudflare Pages dashboard → Settings → Bindings → KV (for the Pages site)"
echo ""

echo "=== Creating R2 bucket ==="
npx wrangler r2 bucket create adventure-movie-images
echo ""

echo "=== Next steps ==="
echo "1. Sign up at https://fal.ai (use Google or GitHub)"
echo "2. Get your API key from https://fal.ai/dashboard/keys"
echo "3. Set secrets on the cron worker:"
echo "   cd workers/daily-story"
echo "   npx wrangler secret put ANTHROPIC_API_KEY"
echo "   npx wrangler secret put FAL_API_KEY"
echo ""
echo "4. Add bindings to Cloudflare Pages (dashboard → adventure-movie → Settings → Bindings):"
echo "   - KV: STORIES_KV → the namespace you just created"
echo "   - R2: IMAGES_R2 → adventure-movie-images"
echo ""
echo "5. Deploy the cron worker:"
echo "   cd workers/daily-story"
echo "   npx wrangler deploy"
echo ""
echo "6. Test with: curl -X POST https://adventure-movie-daily.<your-subdomain>.workers.dev/trigger"
