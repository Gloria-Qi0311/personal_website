/* ════════════════════════════════════════════════════════════════════════
   worker/cms-auth.js — GitHub sign-in for the content editor at /admin/.

   Decap CMS opens a popup on /api/auth; GitHub sends it back to
   /api/callback with a code, which is exchanged here for a token and
   handed to the /admin/ window. The client secret never reaches a browser.

     GET /api/auth      redirect to GitHub's authorize page
     GET /api/callback  exchange the code, post the token to /admin/

   Secrets (Cloudflare dashboard → gloria-qi → Settings → Variables):
     CMS_GITHUB_CLIENT_ID      from Gloria's GitHub OAuth App
     CMS_GITHUB_CLIENT_SECRET  same app, "Generate a new client secret"
   The OAuth App's callback URL is https://<site>/api/callback.

   Only this site's own /admin/ page can receive the token (postMessage
   to our own origin), and a state cookie ties each callback to a sign-in
   that started here.
   ════════════════════════════════════════════════════════════════════════ */

const SCOPE = 'public_repo';
const STATE_COOKIE = 'cms_state';

const html = (body, status = 200, headers = {}) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

// The popup page: answers Decap's handshake, but only from our own origin.
const resultPage = (origin, status, payload) => html(`<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in…</title></head>
<body><p style="font-family:system-ui;padding:2rem;color:#6b655c">Signing in… you can close this window if it doesn't close itself.</p>
<script>
(function () {
  var origin = ${JSON.stringify(origin)};
  var result = ${JSON.stringify(`authorization:github:${status}:${JSON.stringify(payload)}`)};
  if (!window.opener) return;
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.data !== 'authorizing:github') return;
    window.opener.postMessage(result, origin);
    setTimeout(function () { window.close(); }, 100);
  });
  window.opener.postMessage('authorizing:github', origin);
})();
</script></body></html>`, 200, { 'set-cookie': `${STATE_COOKIE}=; Path=/api/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });

const cookie = (request, name) => {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
};

export const cmsAuth = async (request, env) => {
  const url = new URL(request.url);
  if (!env.CMS_GITHUB_CLIENT_ID || !env.CMS_GITHUB_CLIENT_SECRET) {
    return html('<p>Editor sign-in is not set up yet (see docs/admin-login.md).</p>', 503);
  }

  if (url.pathname === '/api/auth') {
    const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', env.CMS_GITHUB_CLIENT_ID);
    authorize.searchParams.set('scope', SCOPE);
    authorize.searchParams.set('redirect_uri', `${url.origin}/api/callback`);
    authorize.searchParams.set('state', state);
    return new Response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        'set-cookie': `${STATE_COOKIE}=${state}; Path=/api/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  // /api/callback
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== cookie(request, STATE_COOKIE)) {
    return resultPage(url.origin, 'error', { message: 'Sign-in expired or did not start here. Please try again.' });
  }
  let token = null;
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'gloria-qi-site' },
      body: JSON.stringify({
        client_id: env.CMS_GITHUB_CLIENT_ID,
        client_secret: env.CMS_GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/api/callback`,
      }),
    });
    token = (await res.json())?.access_token || null;
  } catch (err) {
    console.log(`cms-auth: ${err?.message || err}`);
  }
  return token
    ? resultPage(url.origin, 'success', { token, provider: 'github' })
    : resultPage(url.origin, 'error', { message: 'GitHub sign-in failed.' });
};
