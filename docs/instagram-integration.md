# 1CE v2 — Instagram connection and future Reel publishing (2026-11-15)

## Scope of this change: authorization only

This branch adds **Instagram Business Login** account linking to the existing Upload panel, without running a Reel publisher. YouTube and its private-by-default jobs remain unchanged. **Do not call this production Instagram publishing.** Selecting Instagram still cannot enqueue or upload media; this is intentional until the Meta app is configured and provider/video safety is tested.

### Why this provider
- Use **Instagram API with Instagram Login** for Instagram professional accounts (Business or Creator); Facebook Page linking is not required for this route.
- Scopes: `instagram_business_basic` and `instagram_business_content_publish`.
- Meta code exchange: `https://api.instagram.com/oauth/access_token`; long-lived Instagram access token: `https://graph.instagram.com/access_token`; professional identity: `https://graph.instagram.com/me`.
- OAuth authorization is account- and browser-bound, one-time, 10-minute state. The access token is encrypted at rest with existing publishing secret and never delivered to frontend JS.
- Token lifecycle: long-lived credentials expire (~60 days). A dedicated refresh and reconnect policy is required before production Reel publishing. Disconnect deletes local credentials; user may also revoke access via Instagram settings.
- Config and media publishing are disabled when required settings are missing.

### Meta dashboard — operator setup (never put values in GitHub)
1. In the existing Meta for Developers app, add the **Instagram API** product with **Instagram Login / Business Login**, not an unrelated legacy Basic Display client.
2. Configure the exact Instagram Login redirect URI:
   `https://1ce-v2-production.up.railway.app/auth/instagram/callback`
   Use the real live Railway API callback URL; do not move it to the frontend's `1ce.lol` origin. Set the Meta app's required app domain, website/privacy/deletion URLs and consent fields as required.
3. Request `instagram_business_basic` and `instagram_business_content_publish` and use a professional Instagram test account with app role in development. Users outside tester/developer roles may need Meta Advanced Access, App Review, and Business Verification before the flow works.
4. Set in **Railway > 1ce-v2 > Variables** (do not share secrets in chat):
   - `INSTAGRAM_APP_ID` = Instagram Login client ID associated with the Instagram product
   - `INSTAGRAM_APP_SECRET` = matching Instagram Login client secret
   - `INSTAGRAM_REDIRECT_URI=https://1ce-v2-production.up.railway.app/auth/instagram/callback`
   - `WEB_ORIGIN=https://1ce.lol` **already configured; preserve it**
   - `PUBLISH_TOKEN_KEY` optional for *new installations only*. **Do not add or rotate it on this production instance without a migration plan:** existing YouTube token encryption derives from `GOOGLE_CLIENT_SECRET` when unset. This Instagram feature reuses that stable existing publishing encryption secret to avoid breaking YouTube.
5. After reviewed release and deployment, open `https://1ce.lol/app/upload`, select the publishing upload mode, click **Connect Instagram**, consent through Meta, and check the @username. Confirm disconnect, expired/denied callback, cross-account and state replay tests. Do not assume consent success merely because the Meta login page opened.

### Data and API
- `history/database/018_instagram_connections.sql`: additive `v2_instagram_oauth` and `v2_instagram_connections`, keyed by 1CE account, with encrypted access token and expiration.
- `POST /api/publishing/instagram/connect` -> trusted backend `/auth/instagram/start?state=...` URL.
- `GET /auth/instagram/start` -> Instagram authorization, Secure/HttpOnly/Lax browser binding cookie.
- `GET /auth/instagram/callback` -> validates logged-in account, state, cookie and Meta identity; stores encrypted long-lived token.
- `POST /api/publishing/instagram/disconnect` -> remove local link.
- `GET /api/publishing/status` -> `instagram: {available,connected,username,publishingEnabled:false}`. No raw Meta tokens exposed.
- No public R2 media URLs, no Meta publish requests, no new background tasks.

### Follow-up: actual Instagram Reels

1. Verify exact Meta publishing API variant/permissions for the app and approved professional-account access.
2. Integrate per-user token refresh/reconnection and credential generation checks in the durable queue; **never** reuse a connection after account switch/disconnect.
3. Render vertical MP4 with compliant H.264/AAC, size, duration, aspect and cover specifications; verify official current Meta limits.
4. Upload video to Meta **without permanently exposing private R2 objects**. A documented, short-lived authenticated media-transfer strategy is required. If Meta must pull from URL, design a bounded signed delivery endpoint whose bearer token is not logged and whose lifetime is revoked/expired; do not make buckets public.
5. Container creation -> processing status polling -> `media_publish` -> confirm remote ID/permalink and write durable checkpoint with safe idempotency. After any ambiguous network timeout, quarantine `needs_review` rather than re-publish and risk duplicates.
6. Instagram has no YouTube-style `private` or `unlisted` post visibility. Require **explicit public-post confirmation** per job/destination. A YouTube private job must never silently become a public Instagram Reel.
7. Run isolated contract tests, disposable DB tests, a Meta-test-account published Reel with explicit user consent, and multi-account permission checks before enabling `publishingEnabled:true`.

Official docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login and https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing .
