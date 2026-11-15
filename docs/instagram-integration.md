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

### Reuse the existing v1 Meta developer app — verified in the v1 repository

**Do not create a second Meta app.** Repository `tofdidthat/1ce` has a functional Instagram Business Login implementation under `api/instagram/auth.js`, `api/instagram/callback.js`, `api/instagram/publish.js` and `lib/instagram-token.js`. Its production Vercel project already holds `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, and `INSTAGRAM_REDIRECT_URI` as **sensitive** environment variables (existence verified; values not read or transferred).

- v1 uses the `instagram.com/oauth/authorize` endpoint and permissions `instagram_business_basic,instagram_business_content_publish`, with `enable_fb_login=0` and `force_authentication=1`. v2 matches those login parameters.
- v1 receives OAuth `user_id` and Graph `/me` `id`/`user_id`; **these IDs can differ for the same account**. v2 accepts a successful match against *either* returned Graph ID, while rejecting an unknown identity and preserving long decimal IDs beyond JS's integer-safe range.
- v1 backend and identity data, token sessions, and refresh leases are **not** copied to v2; each person must reconnect using their v2 account. Reuse the Meta application registration and approved permissions, not old user tokens or old internal API secret.
- During migration, **add** the new Railway callback to the existing Meta app's allowed Instagram Login redirect URIs. **Preserve** the old registered URI for rollback until tested; do not overwrite the only valid URI without checking the Meta dashboard.
- v1 also has separate **Meta deauthorization and data-deletion signed_request endpoints** at `api/instagram/auth.js`, which relay to the legacy backend using `ONECE_INTERNAL_SECRET`. Since `1ce.lol` is now hosted by v2, any Meta settings still pointing at `https://1ce.lol/api/instagram/auth` may no longer reach v1's handler. **Before exposing v2 Instagram connection beyond a test account**, inspect the exact configured Deauthorize Callback URL and Data Deletion Request URL in Meta. Preserve handling of existing v1 user data through a verified legacy-compatible endpoint (e.g. the running v1 fallback hostname with its original handler, after testing), or implement a reviewed migration-aware endpoint. **Do not route data-deletion requests to a v2-only handler and claim v1 data were deleted.** Do not disable the callbacks, invent new URLs or change them without verification.

### Meta dashboard — operator setup (never put values in GitHub)
1. Open the **same existing Meta app used by the 1CE v1** in Meta for Developers. Its code already uses Instagram Business Login; verify the product and permissions are present. Do not create another app or change to Facebook Login.
2. Configure the exact Instagram Login redirect URI:
   `https://1ce-v2-production.up.railway.app/auth/instagram/callback`
   **Add** this exact URL to the existing Meta app's Instagram Login redirect allowlist, retaining the existing v1 callback for rollback. Use the live Railway API callback, not the frontend `1ce.lol` origin. Audit the app domain, privacy URL, deauthorize callback and data-deletion URL separately before broader rollout.
3. Request `instagram_business_basic` and `instagram_business_content_publish` and use a professional Instagram test account with app role in development. Users outside tester/developer roles may need Meta Advanced Access, App Review, and Business Verification before the flow works.
4. Set in **Railway > 1ce-v2 > Variables** (do not share secrets in chat):
   - `INSTAGRAM_CLIENT_ID` = the **same Instagram Login client ID as v1** (`INSTAGRAM_APP_ID` still accepted as optional legacy v2 alias)
   - `INSTAGRAM_CLIENT_SECRET` = the **same Instagram Login client secret as v1** (`INSTAGRAM_APP_SECRET` still accepted as optional legacy v2 alias)
   - Never copy secret values into PRs, chats, shell history, screenshots or the browser frontend. Transfer via authenticated provider settings.
   - `INSTAGRAM_REDIRECT_URI=https://1ce-v2-production.up.railway.app/auth/instagram/callback`
   - `WEB_ORIGIN=https://1ce.lol` **already configured; preserve it**
   - `PUBLISH_TOKEN_KEY` optional for *new installations only*. **Do not add or rotate it on this production instance without a migration plan:** existing YouTube token encryption derives from its configured OAuth secret when unset. This Instagram feature reuses the same stable publishing encryption key hierarchy, without rotating the Google, YouTube or Instagram secrets.
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
