const assets = __VIDYUT_ASSET_MAP__;
const assetKeys = Object.keys(assets);
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json(200, { ok: true, service: 'bac-vidyut-sites', schema: 'vidyut.machine.v2', evidence: 'vidyut.evidence.v2', aiMode: 'browser-fallback', assetCount: assetKeys.length, hasIndex: assetKeys.includes('/index.html') });
    if (url.pathname === '/api/ai/status') return json(200, { configured: false, fallback: 'deterministic-browser-planner' });
    if (url.pathname.startsWith('/api/ai/')) return json(503, { error: 'This static deployment uses the deterministic browser fallback. Run the Node service with OPENAI_API_KEY for live GPT-5.6 planning and web research.' });
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = assets[requested] || (!requested.includes('.') ? assets['/index.html'] : null);
    if (!asset) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(decode(asset.body), { status: 200, headers: { 'content-type': asset.type, 'cache-control': requested === '/index.html' ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' } });
  }
};
