# Decap CMS OAuth proxy

A tiny Cloudflare Worker that lets `/admin/` (Decap CMS) authenticate the
single editor (the repo owner) against GitHub without exposing the OAuth
client secret to the browser.

## Architecture

```
Browser /admin/ ──► /auth     ──► GitHub authorize page
                                       │
                                       ▼
                  /callback ◄── GitHub (with code)
                       │
                       ▼  exchange code for token (server-side)
              postMessage(token) ─► Decap /admin/ window
```

The Worker holds `GITHUB_CLIENT_SECRET` as a Cloudflare Worker secret —
never appears in browser code or git history.

## First-time deploy

1. **Deploy the Worker** so we get its URL:

   ```
   cd workers/decap-oauth
   npx wrangler login          # one-time, opens browser
   npx wrangler deploy
   ```

   First deploy will prompt for a `*.workers.dev` subdomain if you don't
   have one yet. Pick anything.

   You'll get back a URL like `https://decap-oauth.<subdomain>.workers.dev`.

2. **Create the GitHub OAuth App**
   <https://github.com/settings/developers> → **New OAuth App**
   - **Application name**: `antaresyuan.site CMS` (or anything)
   - **Homepage URL**: `https://antaresyuan.site`
   - **Authorization callback URL**:
     `https://decap-oauth.<subdomain>.workers.dev/callback`
   - Click **Register application**
   - On the next screen, click **Generate a new client secret**
   - Copy both the **Client ID** and the **Client Secret** — you'll need
     them in step 3.

3. **Set Worker secrets** (paste each value when prompted):

   ```
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

4. **Point Decap at the Worker** — edit `admin/config.yml`:

   ```yaml
   backend:
     name: github
     repo: AntaresYuan/personal_website
     branch: main
     base_url: https://decap-oauth.<subdomain>.workers.dev
     auth_endpoint: auth
   ```

5. **Test**: open `https://antaresyuan.site/admin/` → click **Login with
   GitHub** → authorize → you should land in the Decap editor.

## Updating

Code change to the Worker:

```
cd workers/decap-oauth
npx wrangler deploy
```

Rotate the GitHub client secret (e.g., if leaked):

```
npx wrangler secret put GITHUB_CLIENT_SECRET
# (also click "Reset" on the GitHub OAuth App settings page)
```

## Why no CSRF state token

This is a single-editor personal site. The worst-case attack would be
tricking the owner into authorizing themselves on their own repo —
which produces no harm. If this ever turns into a multi-editor setup,
add a `state` query param signed with HMAC-SHA256 and a Worker secret.
