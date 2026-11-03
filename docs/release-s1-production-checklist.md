# 1CE v2 — S1 release checklist and rollback runbook

**Status:** Pre-release document only. No merge, deploy, Railway patch acceptance, database change, R2 operation or live account test has been authorized by this document.

**Goal:** Release PR #26 (frozen pnpm workspace, isolated auth/upload tests, CI audit) together with the prepared Railway install-path migration, while preserving the current v2 API, user assets, frontend and player. All actions can be performed through connected ChatGPT GitHub/Railway/Vercel tools and GitHub Actions; a computer/terminal is **not** required.

## 1. Known-good baseline and immutable identifiers

- GitHub repo: `tofdidthat/1ce-v2`; PR: [#26](https://github.com/tofdidthat/1ce-v2/pull/26); base branch: `main`; verify SHA again at release.
- Last verified production Git SHA before S1: `feec982df51b2786b7ad4d7e1949b06b58a63bd0` (from previous release).
- Railway project: `courteous-spontaneity` (`31168d29-2738-4a74-8a62-a13d2e2cc52c`), production environment `55e9e0df-8408-4930-8722-63fa1d0d8942`, service `1ce-v2` (`500df83a-095c-413f-890f-321c4f79ba59`).
- Railway previously healthy deployment: `1826dcc1-c63e-4ffd-bfe7-eac6934026a1`, running commit `feec982d`, original source root `/apps/api`, Railpack V3, original build `npm install`, Node 22.23.4.
- Existing API endpoint: `https://1ce-v2-production.up.railway.app`. Existing frontend: `https://1ce-v2-tofdidthat.vercel.app`; Vercel project `1ce-v2`, Node 26.
- **Staged, not live** Railway environment patch `3478c901-975a-48a4-81ee-00a8e13c1a1f`: source root `/`; API-only build command `node --check apps/api/src/server.js`; start command `pnpm --filter @1ce/api start`; watch patterns `/apps/api/**`, `/package.json`, `/pnpm-lock.yaml`, `/pnpm-workspace.yaml`; service-scoped `RAILPACK_NODE_VERSION=22`. It has **five** staged changes. Never accept an unknown/changed patch.

These are historical release references, **not** guaranteed live at a later date. Re-read GitHub and Railway state immediately before acting.

## 2. Preflight: do not start production if any gate fails

- [ ] Explicit user approval for both (a) PR #26 merge to `main` **and** (b) acceptance of the five Railway staged changes. Approval to edit a PR does not imply production release approval.
- [ ] PR head, base, mergeability and upstream `main` checked again. No unrelated commits, database migrations or pending changes; review patch and lockfile.
- [ ] Final-head GitHub Actions API tests, frontend tests/builds (Node 22 and Node 26), `railway-api-smoke` and **dependency-audit** are green. Audit must have successfully queried registries, not silently fallen back to a blank result. High/critical known vulnerabilities are release blockers.
- [ ] Latest Railway `describe_service` shows *exactly* the five expected pending changes, no other staged changes on any service, and old release still healthy. Record current deployment ID and SHA, service config and deployment environment; never print variable values.
- [ ] Confirm existing Railway project, domain, database, bucket and env-variable names; **do not** reconfigure them. Confirm no production auth/upload migrations are included.
- [ ] Agree on release period and how to communicate user-facing errors. Check independent healthy rollback candidate exists; do not claim an old deployment can always be restored after a registry/infra change.
- [ ] Remember: `main` merge may trigger an automatic Railway (old root/npm) build; accepting the Railway patch triggers a second build. **Do not accept the patch against old `main` without `pnpm-lock.yaml`**. Do not promise a single build without verifying a supported, safe deploy-trigger pause first.

## 3. Ordered release execution (only with authorization)

1. Confirm all preflight gates. Ensure the API is responding before making any change. Preserve the SHA and IDs of active deployments. Verify the release branch has **no** secret/env content.
2. Merge PR #26 to `main`, using expected PR head SHA to guard against concurrent changes. If GitHub branch protection or CI fails, stop; do not force.
3. Since Railway already tracks `main` and is currently configured at `/apps/api`, it can automatically build the new source with its existing npm setup. Wait for that deployment to settle; check Railway build/deploy status and `/health`, `/health/db`. If it fails, **do not accept** the pending root migration; restore service first.
4. Re-read the Railway staged patch and compare it to the five known changes. Only once `main` contains the lockfile and the API remains stable, explicitly accept/commit the staged Railway patch. It changes build root and may recreate deployment triggers; this is an active release action.
5. Inspect the resulting Railway **build logs**, not just READY/SUCCESS: must show root `packageManager=pnpm@10.18.0`, recognized `pnpm-lock.yaml`, `pnpm install --frozen-lockfile`, Node 22, API-only `node --check apps/api/src/server.js`, and start command `pnpm --filter @1ce/api start`. If they still show `npm install`, mark release **failed/incomplete**, even if API responds.
6. Confirm the final production Railway deployment runs the expected merged Git commit. Confirm no unexpected extra service build, database migration, or R2 operation. Inspect Vercel production status (may rebuild on `main` changes); ensure frontend remains reachable and no player regression.
7. Run the post-release checks below. Record the deployment IDs, checks and timestamp in the architecture ledger, marking each outcome as observed rather than inferred.

## 4. Post-release acceptance and ownership boundaries

**Safe read-only API probes** (no credentials, no user data changes):

- [ ] `GET https://1ce-v2-production.up.railway.app/health`: status **200**, JSON `{"ok":true,"service":"1ce-v2-api"}`.
- [ ] `GET https://1ce-v2-production.up.railway.app/health/db`: status **200**, JSON `{"ok":true,"database":"connected"}`. A 503 blocks release sign-off.
- [ ] `GET https://1ce-v2-production.up.railway.app/auth/me` with no cookie: **401** (no private account leaked).
- [ ] `GET /auth/me` with untrusted Origin: **403**; `/health` has `Cache-Control: no-store`.
- [ ] Railway logs show successful startup on expected port and no new auth/database error, no repeated crashes. Review status/metrics and error rates, avoiding sensitive payloads.
- [ ] Vercel current production serves the UI with existing Home/World/Profile navigation and player. GitHub CI green on merged SHA.

**Authorized test-account-only checks:** These require a user-approved isolated account and must **not** be run on a real user's media merely to satisfy a checklist. Do not place tokens/passwords in chat, logs, tests or source control.

- [ ] Login/logout and Google OAuth with a test account; ensure state/replay rejection and session handling in real deployment.
- [ ] Private Home and Catalog/Saves visibility (anonymous cannot see private assets); authorized audio and cover playback.
- [ ] Controlled small synthetic beat upload, pack reference, R2 completion and checksum validation; verify duplicate reuse and no asset copies. Avoid testing malformed/dangerous media on production. Existing upload TOCTOU/validation P0 risks remain and must be addressed in a separate security batch.

## 5. Incident handling and rollback

**Stop and escalate:** Any unexpected origin of deployment, missing lockfile, npm-only installation after patch, Node drift, failed `/health/db`, unexpected permission changes, 401/403 regression, missing user projects, broken player or R2 write failure blocks sign-off.

1. Stop further releases, do not retry uploads blindly, and preserve deployment/build logs and timestamps. Avoid logging secrets, cookies, tokens, presigned URLs or private media.
2. Check whether the fault is caused by source, pending/live Railway config, or external database/storage. If the **new Railway build** is unhealthy, use Railway's previous healthy deployment **redeploy/rollback** only after confirming it belongs to the same service/environment and can still be reused. Pre-S1 known-good candidate was deployment `1826dcc1-c63e-4ffd-bfe7-eac6934026a1`, but verify its present rollback eligibility.
3. Reverting a deployment alone may **not revert live service configuration**. If the new root/start/build setting causes the issue, restore the prior Railway config (`/apps/api` root, prior automatic build/start, prior watch patterns and removal of S1-only `RAILPACK_NODE_VERSION`) using Railway's supported controls, check the config read-back, and redeploy the known-good source **in a controlled sequence**. Do not apply another unrelated pending environment patch.
4. If source-only regression, revert the merged commit through a reviewed GitHub PR, not an unreviewed force-push. Re-run tests before release. If frontend fails, use the known-good Vercel deployment or a reviewed rollback/promotion, verifying SHA and environment; don't assume Railway rollback reverts Vercel.
5. After service recovery, re-check `/health`, `/health/db`, anonymous auth response, permitted/private media, and errors. Confirm all config changes/rollbacks were explicitly approved and record what was actually done.
6. Never delete production DB rows, R2 objects or original project media as an automatic rollback; S1 includes no migrations and should require no data rollback.

## 6. Items expressly outside S1

- P0 actual media magic-byte/ZIP parsing, immutable R2 final-object promotion, post-verification signed PUT overwrite risk, bounded streamed verification, upload quotas/rate limits and distributed proxy-aware auth throttling.
- Full real Google OAuth, uploads or private cross-user browser E2E as CI gates; those need authorized test accounts and environment-specific fixtures.
- No local machine or terminal is needed for the user. All current development actions are remote through ChatGPT connectors and GitHub Actions.
