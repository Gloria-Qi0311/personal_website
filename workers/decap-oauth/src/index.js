// ─────────────────────────────────────────────────────────────────────
// Decap CMS OAuth proxy for GitHub.
//
// Two endpoints:
//   GET /auth      Redirect the browser to GitHub's authorize page.
//   GET /callback  Handle GitHub's callback, exchange the code for an
//                  access_token, and postMessage it back to the Decap
//                  /admin/ window that opened the popup.
//
// Required Worker secrets (set via `npx wrangler secret put NAME`):
//   GITHUB_CLIENT_ID
//   GITHUB_CLIENT_SECRET
//
// Single-editor / personal-site posture: no CSRF state token. Risk is
// low (attacker would only ever fool the owner into authorizing as
// themselves on their own repo). Add `state` later if multi-editor.
// ─────────────────────────────────────────────────────────────────────

const SCOPE = 'repo,user';

const responseHtml = (status, payload, provider = 'github') => `<!doctype html>
<html><head><meta charset="utf-8"><title>Authorizing…</title></head>
<body><script>
(function() {
  function send(message) {
    if (window.opener) {
      window.opener.postMessage(message, '*');
    }
    setTimeout(function () { window.close(); }, 100);
  }
  // Tell Decap we're authorizing — Decap will then ask for the result.
  function onMessage(e) {
    if (typeof e.data !== 'string' || !e.data.startsWith('authorizing:${provider}')) return;
    send(${JSON.stringify(`authorization:${provider}:${status}:`)} + ${JSON.stringify(JSON.stringify(payload))});
  }
  window.addEventListener('message', onMessage, false);
  send(${JSON.stringify(`authorizing:${provider}`)});
})();
</script><p style="font-family:system-ui;padding:2rem;color:#5A5A66">
Authorizing… you can close this window if it doesn't close itself.
</p></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── /auth: kick off the OAuth flow ─────────────────────────────
    if (url.pathname === '/auth') {
      const provider = url.searchParams.get('provider') || 'github';
      if (provider !== 'github') {
        return new Response('Unsupported provider', { status: 400 });
      }
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorize.searchParams.set('scope', SCOPE);
      authorize.searchParams.set('redirect_uri', `${url.origin}/callback`);
      return Response.redirect(authorize.toString(), 302);
    }

    // ── /callback: exchange code for token ─────────────────────────
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('Missing code', { status: 400 });

      let token = null;
      try {
        const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'decap-oauth-proxy',
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: `${url.origin}/callback`,
          }),
        });
        const data = await tokenResp.json();
        token = data.access_token ?? null;
      } catch (_) {
        token = null;
      }

      const status = token ? 'success' : 'error';
      const payload = token
        ? { token, provider: 'github' }
        : { message: 'token exchange failed' };
      return new Response(responseHtml(status, payload), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // ── Fallback: friendly index page ──────────────────────────────
    return new Response(
      'Decap OAuth proxy. Endpoints: /auth · /callback.\n' +
      'Source: github.com/AntaresYuan/personal_website/tree/main/workers/decap-oauth\n',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  },
};
