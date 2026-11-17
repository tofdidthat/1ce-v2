# 1CE v2 — TikTok Login Kit e Content Posting API

**Checkpoint 2026-11-17 — T01 connection foundation (candidate, OFF unless configured).** The v2 runtime was checked before this work: `https://1ce.lol` resolves to Vercel v2; Railway API and PostgreSQL reported SUCCESS/online. Source main includes PR #105 (Instagram Meta callback support, publication recovery and browser request-ID reconciliation). The older [PR #104](https://github.com/tofdidthat/1ce-v2/pull/104) documentation review was still **OPEN / no longer directly mergeable**, so **do not** copy its historical production claims into a new release without reconciliation. Instagram and YouTube remain working integrations.

## What T01 implements

- Dedicated backend `tiktok-connection.ts`, migrated via additive `history/database/022_tiktok_connections.sql`, no change to existing 1CE media/pack tables.
- TikTok **Login Kit Web** OAuth: authenticated `POST /api/publishing/tiktok/connect` issues a 256-bit random ticket stored as SHA-256, account-scoped; first-party `/auth/tiktok/start` sets a Secure/HttpOnly/SameSite=Lax cookie and redirects to TikTok; exact registered `GET /auth/tiktok/callback` checks user, state, cookie, expiry and one-time claim, exchanges code server-side and stores ciphertext.
- Required scopes in this preliminary connection: `user.info.basic,video.publish`. TikTok app approval is required; the callback rejects and stores nothing unless **video.publish** is actually in the granted scopes. Access + refresh tokens use the existing AES-256-GCM account/purpose binding, generation ID and expiries; no raw tokens sent to the web UI.
- Authenticated `POST /api/publishing/tiktok/disconnect` deletes pending ticket and stored credentials, attempts official remote token revocation and reports `providerRevoked:false` if TikTok could not confirm. If revocation cannot be confirmed, the user should also revoke the app in TikTok settings.
- `GET /api/publishing/status` exposes only `tiktok: {available,connected,publishingEnabled:false}`; UI adds a TikTok Connect/Disconnect action in the **existing** compact Destinations popover, without redesigning YouTube’s `⋯`, 16:9/9:16 preview, Instagram consent or history.
- **No TikTok upload, direct post, queue target, provider media transfer or background worker is enabled in T01.** A TikTok-only or combined destination remains **non-publishable**; the API rejects those jobs even when connected. The connection alone never creates a post.

## Configuration (operator action, never commit secrets)

Official developer portal: https://developers.tiktok.com/ . Register an app; add **Login Kit** and **Content Posting API**. In the Login Kit Web settings register:

```
https://1ce-v2-production.up.railway.app/auth/tiktok/callback
```

Add these **names** to private Railway variables only after TikTok has approved the app and appropriate scopes:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI=https://1ce-v2-production.up.railway.app/auth/tiktok/callback`
- `WEB_ORIGIN=https://1ce.lol` (already in production, do not change)
- Existing stable OAuth-derived publishing encryption secret; **do not rotate `PUBLISH_TOKEN_KEY` or Google/YouTube client secrets without migration**.

When any TikTok variables are missing, `tiktok.available=false`; TikTok Connect is disabled, and **YouTube/Instagram continue working**. No dedicated TikTok variables were present in the Railway variable-name inventory checked on 2026-11-17. No credentials were invented or created.

## T02 — Direct Post is a separate, gated change

TikTok’s current official requirements are **not equivalent** to YouTube/Instagram:

1. Obtain TikTok approval for **`video.publish`**, enable Direct Post and pass required app audit for public visibility. The official guide says unaudited clients are **private-only**, not public posts.
2. Before each post query `/v2/post/publish/creator_info/query/`; the form must display real account identity, current **`privacy_level_options`** and interaction options, and cannot assume YouTube’s privacy selector applies. Respect creator video-duration limits and explicit user consent. Review branded-content and AI-content labels.
3. Render MP4 per creator restriction; `video.init` can use `FILE_UPLOAD` (sequential chunks, signed TikTok upload URL) or `PULL_FROM_URL` only after domain/prefix ownership verification. Do not expose the private R2 bucket. Retain immutable post checkpoints and distinguish `publish_id` from final video ID/status.
4. Introduce an independently fenced and idempotent TikTok worker and provider-specific post settings; test ambiguous timeouts, duplicate prevention, disconnect/reconnect, token refresh **rotation** and expiry, unexpected creator privacy changes, App Review visibility and owner isolation on disposable assets. Do not auto-publish on account connection or destination selection.
5. Only after scopes, app approval, separate UI and end-to-end test are confirmed should `publishingEnabled` become true and TikTok be accepted as a queue target.

**Official docs verified 2026-11-17:**
- [TikTok Login Kit for Web](https://developers.tiktok.com/docs/en/login-kit-web)
- [Get User Access Token](https://developers.tiktok.com/docs/en/oauth-get-a-user-access-token)
- [Refresh Token (rotating)](https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token)
- [Revoke Token](https://developers.tiktok.com/docs/en/oauth-revoke-a-user-access-token)
- [Content Posting API — Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [Query Creator Info](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info)
- [Media Transfer Guide](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)

## Operational boundaries and release gates

- All T01 tests/CI must pass on the final commit, including migration on disposable PostgreSQL. Test OAuth start/callback with synthetic tokens; no real TikTok external requests from automated CI.
- Do not set any `TIKTOK_*` variables, request new permissions, change TikTok developer portal, merge to production, deploy or publish actual content without operator review.
- T01's encrypted refresh grant is persisted; **automatic refresh/rotation is intentionally not yet active** because no publishing job uses it. Before T02, add CAS/lease-based refresh, prevent stale token resurrection, test 180-day refresh expiry and explicit reauthorization.
- Previous safety review documented Meta deauthorization/data-deletion and ambiguous publication issues; PR #105 landed related mitigations, but correctness of real Meta dashboard callbacks and provider side effects remains an operational acceptance item, not implied by CI.
