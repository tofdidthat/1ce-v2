# 1CE v2 — PR #27 (S2) security release and rollback checklist

**Status:** Draft PR, branch-only. This file authorizes no database migration, merge, production deploy, R2 write, cleanup or account testing. A second AI should review the exact PR diff, final-head CI and remaining risks before the user approves a release.

## Architecture and invariant

- API: `apps/api/src/library-files.js`, `upload-security.js`, `api-rate-limits.js`. Existing frontend `PUT uploadUrl` contract is unchanged.
- Every signed PUT URL is for `users/<id>/assets/<kind>/pending/<uuid>.<ext>`, with 300-second expiry, declared MIME and length. It is NEVER the `object_key` of a READY file.
- `complete` checks ownership, pending age (30 minutes), metadata, then copies staging with server-side R2 credentials to a fresh `.../verified/<uuid>.<ext>` key. It reads **the final copy** to verify exact SHA-256, exact byte count and media signature/ZIP structure before atomically updating `object_key` and `status='ready'`. A still-live signed PUT can only affect disposable staging. No existing READY keys are migrated.
- Verification reads are streaming (SHA-256, bounded 4096-byte prefix/16-byte tail), with byte cap equal to declared size, per-kind timeout (audio 120 s, cover 45 s, stems 180 s). ZIP reads EOCD/central directory and matching local header names with bounded ranges; max 200 entries, 2 MiB central directory, 2 GiB total uncompressed, 1 GiB per entry, 1000x ratio, no encryption, symlink, path traversal, unsupported compression, ZIP64 or multi-disk. This is a defensive structural inspection, **not** a full audio/image decoder or archive decompression scan.
- Account quotas: at most 10 recent pending files (30-minute window), at most 10 GiB READY + recent pending bytes, 80 upload inits/hour and 120 completion attempts/hour. PostgreSQL advisory transaction serializes owner reservations across API replicas.
- Login: 20 attempts/15 minutes keyed by SHA-256 of normalized account identifier, using atomic PostgreSQL rolling window. No per-process IP Map; do not trust Railway reverse-proxy socket IP as a per-user identity. Distributed attacks with rotating emails remain a residual risk; consider edge/WAF limits later.
- Migration: `history/database/010_api_rate_limits.sql` creates an isolated v2 throttle table and index. **Apply it before deploying the API**, or login/upload endpoints will fail closed with 500. Never apply to v1.

## Release gates — all required

1. Inspect final PR #27 diff for correct R2 `CopyObjectCommand` behavior, conditional `CopySourceIfMatch` compatibility, `GetObject` range responses, MIME/file examples, concurrency and cleanup. Do not rely solely on mocked tests.
2. Verify GitHub Actions API tests, web Node 22/26 builds, dependency audit and Railway API smoke all green at **final head**. Check no preview deployments were triggered.
3. Confirm Railway `1ce-v2` is healthy on the expected S1 commit; Vercel is READY; `/health` and `/health/db` succeed. Capture deployment IDs and known-good rollback target.
4. With explicit user approval, apply only additive SQL `010_api_rate_limits.sql` to the isolated v2 PostgreSQL. Verify table and index. Do not run any SQL against v1 or remove user data.
5. With explicit separate approval, merge PR #27 to main and allow Railway deployment. Watch build and runtime logs; ensure API starts and connects to the database. Frontend code should be unchanged, but verify Vercel still READY.
6. Perform a user-approved **disposable test-account** upload for a real MP3, WAV, JPEG/PNG/WebP and ZIP stems using R2, then stream/download the READY assets. Confirm `CopyObject`, `CopySourceIfMatch`, `GetObject Range`, CORS direct PUT, SHA and metadata work on actual Cloudflare R2. Verify a second PUT to the staging URL after completion cannot change READY. Do not test using another person's files.
7. Confirm anonymous/owner isolation, expired session, Google login, 429 throttling with a test account, 30-minute pending behavior, dedup and existing READY assets. Monitor error rates and CPU/R2 traffic; final hash verification reads the full object and ZIP inspection makes additional ranged requests.

## Rollback and incident response

- If API fails on deploy, restore the last known-good Railway deployment from S1 and confirm `/health`, `/health/db`, auth and existing media. The additive throttle table can safely remain unused; do not drop it during emergency rollback.
- Never revert `library_files.object_key` to a staging key for any new READY row; it references the server-verified final object. Old S1 code can still read these keys because it uses the DB key transparently, but **old upload completion logic** must not be used for newly staged uploads during rollback.
- Preserve existing ready objects, pending records and R2 data. Never bulk-delete `/pending/` or `/verified/` during rollback. Use a separately reviewed R2 lifecycle policy to expire unreferenced staging keys only after signed URLs and retry windows have elapsed; this PR does **not** install that policy.
- If the new CopyObject API is incompatible with R2 or legitimate uploads fail signature checks, roll back the API and investigate with synthetic test assets. Do not bypass verification in production or silently mark unverified media READY.
- Operational maintenance for throttle rows (not executed here): `DELETE FROM v2_api_rate_limits WHERE window_started_at < now()-interval '7 days';` Schedule only after review; table otherwise grows with unique subjects.
- Existing S1 READY keys were signed before PR #27; they are **not** retroactively copied into verified storage. Previous signed URLs expire after their original TTL. No v1 assets are touched.

## Review status

Update this section with final PR head, CI run IDs, tests, any real R2 integration evidence, and explicit release approval. Never claim production deployment based only on branch CI.
