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

## R02 — gated Instagram Reels publisher (PR candidate, not enabled)

**R02 is OFF by default.** Code, tests and schema can be reviewed/merged without sending any video to Meta. Publishing requires an explicit operator change to `INSTAGRAM_REELS_ENABLED=true` **after** validation and a controlled test Reel authorized by the account owner. Never set this flag just to check connection status.

- Instagram-only or simultaneous YouTube + Instagram jobs use the same verified audio/cover upload. YouTube keeps its independent `private|unlisted|public` choice. Each Instagram job must carry `instagramPublicConsent: true` from a visibly checked per-job checkbox. The server revalidates the consent, owner, selected destinations, connection generation, media ownership and feature flag before queueing.
- The worker renders an H.264/AAC 9:16 MP4 (initially up to 3 minutes), verifies source ownership and keeps original library files private in R2. It writes a separate checkpoint and temporary rendered artifact.
- For Instagram Login, Meta cURLs `video_url` from a publicly reachable HTTPS endpoint. 1CE's `/api/publishing/meta-media?token=...` is **not a public bucket**: it validates a cryptographically random, SHA-256-hashed, expiring media grant for one in-flight, owner-approved job and streams only the rendered MP4. No original audio/cover, full R2 listing or permanent anonymous access is exposed. The link can be fetched by anyone holding it until its expiration; do not log or share capability URLs.
- The Meta Graph contract uses the account verified live via `/me`, creates `media_type=REELS`, checks container `status_code`, and only then invokes `media_publish`. The attempt ledger sets `publish_started_at` **before** the irreversible network request; timeouts, expired worker claims or unknown acknowledgments must enter `needs_review`, never blindly publish a duplicate.
- R02 adds **019_instagram_reels.sql** (additive tables and columns, without destructive operations). YouTube publishing paths remain available and do not gain Instagram public visibility.
- `instagram.publishingEnabled` in `/api/publishing/status` stays false until Meta config, R2/FFmpeg, connected account and the server flag all validate.

### Release gates before setting the flag

1. Confirm the existing v1 Meta app has the necessary permission for the professional Instagram test account; for external accounts, check Meta Advanced Access and app review requirements.
2. Audit live Meta deauthorization and data deletion URLs. These may still point at the old v1 backend; preserve legal handling of v1 data separately, as documented above.
3. Verify 7/7 CI checks, isolated PostgreSQL migration 019, queue ownership/consent tests, credential refresh/expiry test, and temporary media grant GET/HEAD/Range, expiration and owner isolation. Check Cloudflare R2 remains private.
4. Review media delivery URL query token exposure in Railway access logs, CDN, observability and Meta's request logs. Scrub query strings. Test Meta's actual fetch behavior, headers and long-processing retry conditions.
5. Run exactly one approved public test Reel on a dedicated professional test account. Verify the real Instagram media ID, presence/visibility, per-platform result in 1CE and strict no-duplicate behavior under uncertain acknowledgments.
6. Confirm disconnect/reconnect while queued or running fences old generation. Verify YouTube private video remains private in a combined job.
7. Enable gradually, monitor Meta errors/rate limits, then consider app-wide rollout. No automatic background publication from simply connecting an account.

Reference: [Meta Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing). Meta documents a 100 API-published-posts per 24-hour moving limit; provider limits and policies may change.

## T030 — security and recovery candidate (not a production attestation)

The candidate adds signed, migration-aware Meta callbacks at
`POST /api/instagram/meta-compliance?action=deauthorize|data-deletion`.
The frontend rewrite preserves `/api/instagram/auth` and its `action` query;
the API forwards validated signed requests to the fixed v1 fallback host.
The existing Meta dashboard is not modified by this change.

- HMAC-SHA256, exact decimal user IDs, bounded bodies and no-store responses
  protect the callback. Migration 020 stores pseudonymous V2 identity links and
  hashed callback receipts. A PostgreSQL advisory lock serializes duplicate
  deliveries, and the receipt prevents a replay from revoking a later connection.
  Receipts contain only a digest, action, time and validated v1 acknowledgement.
- V1-only deletion responses pass through. For a known V2 identity, V1 is called
  once after a confirmed receipt and V2 returns HTTP 503
  `v2_data_deletion_contract_required`. **V2 deletion is incomplete** until the
  owner defines the records to erase and their retention requirements. The
  callback must not delete library media or account data on an assumed scope.
  A lost database commit after a successful v1 call may cause another v1
  delivery; the legacy deletion operation must remain idempotent.
- Graph resource requests use Bearer headers; code exchange and YouTube refresh
  use POST bodies. Meta's current [Business Login documentation](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
  still specifies GET parameters for Instagram long-token exchange and refresh.
  No unsupported POST/header replacement is introduced for those endpoints.
  Meta also fetches a public HTTPS `video_url`; its scoped, expiring capability
  cannot be replaced with a custom request header controlled by 1CE.
- Application diagnostics strip complete URL queries, including encoded
  redirects, and credential/header fields. Synthetic tests cover OAuth,
  media capabilities, R2 signatures and YouTube upload session IDs. **This does
  not configure provider/proxy logging.** Before release, verify query omission
  in Railway/Vercel access logs and any HTTP tracing; never copy raw callback,
  refresh, media delivery or resumable URLs into logs.
- The browser retains an account-scoped request UUID and hashed intent across
  reloads, including terminal history results. It blocks a submission if it
  cannot persist the recovery record. Same media/details recover the old job;
  an explicit “Start another publication” after acknowledgement permits a new
  identical publication. Editing details is a different intent. Clearing site
  data or changing browser/device loses this local recovery record; the server
  still enforces idempotency for any request UUID it receives.
- A provider-confirmed Reel whose settle loses its lease is reconciled to
  `needs_review` with its media ID, using the original attempt and persisted
  checkpoint. No provider request occurs in reconciliation. Process/database
  interruption after `publish_started_at` is quarantined on lease expiry.
- The existing disposable PostgreSQL CI runner includes Instagram lease expiry,
  late confirmation, checkpoint failure, crash recovery, reconnect and concurrent
  callback delivery scenarios. Meta/R2 are simulated. Local unit tests do not
  establish that live Meta callback URLs, legacy hosting, edge query logging or
  production deletion behavior are configured correctly.

### T030 follow-up verification (2026-11-16)

- Reproduced the cancelled Node 26 CI job: a synchronous storage exception in
  its native Web Locks callback left the promise pending. The callback now
  rejects asynchronously. A bounded regression covers rejection/recovery and
  concurrent reservations. All 205 web tests pass locally on Node 22 and 26;
  API tests pass (266 passed, one renderer test skipped locally).
- An isolated Chromium check exercised the actual recovery module with real
  localStorage/Web Locks: reload, a second tab, twelve concurrent reservations,
  account isolation, storage rejection, acknowledgement and explicit restart.
  No publishing API was called; this does not attest the full signed-in UI.
- A bounded Railway production sample for 2026-11-16 00:00–16:15 UTC contained
  101 status requests and two media-delivery requests, with no query strings in
  the returned paths. The 36 runtime records sampled contained no credential
  markers. These samples do not establish upstream tracing or retention policy.
  No raw log records or credentials are included in this evidence.
- The fixed v1 callback returned HTTP 400 `Invalid signed request` for an
  intentionally invalid synthetic signature. No valid deletion/revocation was
  sent. Successful signed forwarding and v1 backend deletion remain unverified.
- The Meta dashboard had no authenticated session. Vercel project access
  returned HTTP 403 for the configured team, despite MCP connection readiness;
  its access logs could not be inspected. No configuration was changed.
- Neither the generic retention language in `apps/web/src/legal.tsx` nor the
  v1 callback's forwarding contract defines which V2 publication/library/account
  records a Meta deletion should erase. This remains a product decision, not a
  completed P0: known V2 subjects still receive 503, with no deletion claim.
