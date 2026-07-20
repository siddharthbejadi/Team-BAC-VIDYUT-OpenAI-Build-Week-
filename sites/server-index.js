const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json(200, { ok: true, service: 'bac-vidyut-sites', schema: 'vidyut.machine.v2', evidence: 'vidyut.evidence.v2', aiMode: 'browser-fallback' });
    if (url.pathname === '/api/ai/status') return json(200, { configured: false, fallback: 'deterministic-browser-planner' });
    if (url.pathname.startsWith('/api/ai/')) return json(503, { error: 'This static deployment uses the deterministic browser fallback. Run the Node service with OPENAI_API_KEY for live GPT-5.6 planning and web research.' });
    if (environment?.ASSETS?.fetch) return environment.ASSETS.fetch(request);
    return new Response('Static asset binding is unavailable.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};
