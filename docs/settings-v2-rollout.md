# v2 Settings identity rollout (feature branch; NOT deployed)

Scope: reconstruct the **left account column** from the v1 Settings visual as a new v2 component. Do not reuse v1 token, account backend, Stripe, database or storage. Billing/subscription controls are intentionally absent until a v2 billing contract exists.

## Contract

- `GET /auth/me`: existing authenticated session endpoint, extended with `username`, `has_avatar` and `avatar_updated_at`.
- `PATCH /auth/me` with `{"username":"artist.name"}`: authenticated username update; returns updated `user`. `400` invalid, `401` unauthenticated, `409` occupied.
- `POST /auth/me/avatar` with raw binary JPEG/PNG/WebP and matching `Content-Type`: authenticated upload, max 5 MiB; server verifies signature; returns updated `user`. Does not mutate projects or their cover assets.
- `DELETE /auth/me/avatar`: authenticated custom-photo removal; Google photo remains a fallback; returns updated `user`.
- `GET /api/public/avatar/:accountId`: displays the account's approved custom avatar from private v2 R2 storage. No public bucket permissions or object keys exposed. `404` if absent.
- `GET /api/public/profile/:identifier`: existing profile endpoint now accepts numeric ID **or normalized username**. All Catalog/Saves queries still use the resolved numeric account ID; this does not alter project authorization.
- Public sharing links prefer `/u/:username`, with numeric-ID fallback for accounts that haven't selected a username.

Username policy: 3–24 lowercase ASCII characters, `a-z`, `0-9`, `.`, `_`; begin/end alphanumeric; no consecutive dots; numeric-only usernames are disallowed to avoid colliding with existing `/u/:id` routes. Database unique index rejects duplicates.

## Deployment order (important)

1. Verify project environment points exclusively to the **v2** Railway PostgreSQL and private v2 R2 bucket. Never run a migration on the v1 database.
2. Apply `history/database/007_profile_identity.sql` in the isolated **v2** PostgreSQL. This adds nullable `account_users.username`, `avatar_key`, `avatar_updated_at`. No existing accounts or assets are overwritten. Verify the new columns/index.
3. Run `pnpm --filter @1ce/api test`, `pnpm --filter @1ce/web typecheck`, `pnpm build` on this feature branch and inspect Vercel preview.
4. Deploy the updated v2 API on Railway **only after step 2**; otherwise `currentUser` reads missing columns and `/auth/me` fails.
5. Deploy v2 frontend and test `/app/settings` on Vercel. The current single `WEB_ORIGIN` can remain pointed to Vercel; local Google OAuth / localhost CORS is a separate, unresolved task.
6. Use two distinct authenticated test users in separate browser profiles (not just two tabs sharing a cookie). Select two distinct usernames and verify `/u/username`, avatar upload/remove, conflicts, bad images, and logout. Do not test using v1 sessions.
7. Validate project permissions: unpublished private beat cover/audio denied to second user; published projects accessible according to public policy; saved relationship is not a grant; redeemed share grants authorized access; stems remain owner-only pending policy decision.
8. Update `docs/refactor-phase-a-inventory.md` with observed API HTTP status codes and the test evidence before declaring Phase A complete.

## Known limitations

- Avatar is intentionally a separate account asset from project cover; a Settings photo change must not mutate beats/packs/R2 project files.
- A successful photo upload followed by a failed username update can yield partial success; UI refreshes the saved photo and reports the username error without reuploading it.
- Backend tests use mocked DB/R2. Real PostgreSQL and R2 integration testing is still required for Phase A closure.
- This branch does not solve cross-origin local Google login, or add v2 Stripe billing.
- Profile name and username may differ; changing username does not change the numeric account ID or ownership of a project.
