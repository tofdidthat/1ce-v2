# 1CE v2 — Architecture, operations and release guide

> **Canonical technical reference.** Last consolidated on 2026-11-04 UTC from `main` at `9f0bd2c89e49a3d332e11e805799c07710a47ace`. It describes repository source and dated operational evidence, **not** an automatic report of the live Railway/Vercel deployments. Recheck GitHub, Railway, Vercel and Cloudflare before making release or deletion decisions. Previous Markdown ledgers remain available via Git history and their pull requests; they are intentionally not kept as separate files.

## 1. Mission, boundaries and product decisions

- **v1 is strictly read-only.** Do not change the v1 repository `tofdidthat/1ce`, production site, database, bucket, tokens, OAuth clients, domains or sessions while working on v2. Migration of approved identity/user data requires a separate plan and authorization; never import v1 sessions or OAuth tokens.
- **v2 repositories:** frontend + API source in `tofdidthat/1ce-v2`; Vercel project `1ce-v2`, Railway project `courteous-spontaneity` and a separate v2 PostgreSQL database.
- **UI labels and design:** Home is the former Library, World is the former Discover. The app UI is English. Reuse existing components, iconography and CSS. Do not split beats and packs into redundant Library sections. The music player/queue, waveform and current playback must survive navigation and data refresh.
- **Original media, no copies:** packs reference their member beats; publication, saves and sharing create relationships rather than duplicate audio/cover/stems objects.
- **Storage plan:** the provisional technical default is **10 GiB per account** in the database plan model; this does not authorize paid tiers, pricing, billing or Stripe integration.
- **Files and operations:** prioritize safe, reversible batches, TypeScript in the frontend and explicit server-side ownership validation. The API is currently Node.js JavaScript; migrating it to TypeScript is an architectural option, **not** a completed step.

## 2. Code map

| Responsibility | Current paths |
| --- | --- |
| Frontend routes and session entry | `apps/web/src/main.tsx` |
| Workspace, Home, World, upload views | `apps/web/src/workspace-v1.tsx`, `world-v2.tsx`, `library-upload-v1.tsx` |
| Library grid, beats/packs, player | `apps/web/src/library-items-v2.tsx`, `library-items-v2.css` |
| Project menu and actions | `apps/web/src/project-context-menu-v2.tsx`, `project-action-dialog-v2.tsx`, `project-requests-v2.ts` |
| Cover and project data | `apps/web/src/project-cover-v2.tsx`, `project-cover-cache-v2.ts`, `project-read-v2.ts` |
| Profile, follows, edit controls | `apps/web/src/public-profile-v2.tsx`, `edit-profile-panel-v2.tsx`, `profile-follows-v2.ts` |
| Settings and Trash UI | `apps/web/src/account-settings-v2.tsx`, `trash-settings-v2.tsx` |
| Frontend data refresh | `apps/web/src/data-refresh-v2.ts` |
| API entry, auth/sessions/OAuth | `apps/api/src/server.js` |
| Private uploads and Library files | `apps/api/src/library-files.js`, `upload-security.js`, `upload-leases.js` |
| Project mutations | `apps/api/src/project-actions.js` |
| Trash, restoration and R2 outbox | `apps/api/src/trash.js` |
| Public profiles, saves, publications, links | `apps/api/src/public-profiles.js`, `profile-identity.js`, `profile-follows.js` |
| Access-controlled media and ranges | `apps/api/src/project-media.js`, `audio-stream.js` |
| Quotas and API rate limiting | `apps/api/src/storage-plans.js`, `api-rate-limits.js`, `login-admission.js` |
| SQL migrations and isolated smokes | `history/database/`, `apps/api/scripts/`, `apps/api/test/`, `apps/web/test/` |

The entry point `apps/api/src/server.js` delegates to feature handlers, which must perform authorization **again on the server**. File IDs and project IDs are not interchangeable; project identity should include owner, kind and project ID. Preserve existing HTTP routes until frontend consumers have migrated and been regression-tested.

### Frontend behavior and media access

- Home lists owned standalone beats and packs; a pack-only beat must not appear as an extra standalone card. A beat previously visible individually remains so when added to a pack.
- Profile Catalog/Saves/Following use viewer-appropriate visibility. A **Save** is not by itself a permission grant to stream a private asset; publishing or an explicit share grant establishes access. Private media stays in R2 and is served only through authorized backend endpoints.
- Audio streaming supports standard and byte-range responses; verify `200`, `206`, `416` and cache/security headers. Stems must remain owner-restricted until a separate access policy is expressly approved.
- Use shared refresh notifications and source-backed project identity. Do not reset upload destinations, player state or project listing on routine refresh. Test rapid navigation, playback, saves, shares and profile changes in two distinct browser sessions.

## 3. Database, storage and migrations

**Primary relational model:** `account_users`, `account_sessions`, `library_files`, `library_beats`, `library_packs`, `library_pack_beats`, and public/saves/access/share relationship tables. A beat references its original audio plus optional cover and stems. Packs reference existing beats and optionally a cover; ordering lives in `library_pack_beats`. `library_files` stores owner, object key, kind, size, hash/status and other metadata — **not binary media**. Deduplication is scoped to account and file kind; shared references must not cause a second R2 upload.

All versioned SQL stays in `history/database/`. **Do not rename, reorder or delete those files** during documentation housekeeping. The sequence contains `001` through `012` and two historical `004_...` files with distinct purposes; always inspect exact filenames and previously applied state instead of inferring from a number alone.

**Dated production v2 evidence (2026-11-03):**

- `010_api_rate_limits.sql` applied in v2 production, for API/login quotas and rate limits.
- `011_storage_plans_completion_leases.sql` applied in v2 production, adding default 10-GiB plans and per-file completion leases.
- `012_trash_and_r2_delete_outbox.sql` applied and checked **6/6** against v2 production PostgreSQL; the temporary Railway executor was removed. The guarded `012_trash_and_r2_delete_outbox_safe_psql.sql` is for reviewed, operator-controlled use with `psql`, **not** a reason to apply the migration again.
- These production migration statements are historical **observed** evidence; verify current database state read-only before any new migration. Never execute them on v1.

**R2 contract:** store each user's media beneath `users/<numeric-owner-id>/` using verified audio/cover/stems object keys. Signed staging uploads must be verified before promoting immutable READY media. No client-supplied object key may authorize deletion. The R2 `staging/` lifecycle expiration after 24 hours was **reported configured by the user**; it is separate from Trash's 30-day restore window and does not authorize expiration under `users/` or `verified/`. Keep R2 credentials, bucket policy, signed URLs and backups private.

**Upload safety:** check ownership, verified media signatures, size/limits, hash-based deduplication, concurrent-completion leases, advisory locking and rate limits; fail closed on validation/ETag mismatch. A read-only orphan audit exists at `apps/api/scripts/s2-orphan-audit.mjs`; it lists only candidates. It is **not** a destructive sweeper and does not substitute for a separately authorized cleanup design.

## 4. Trash: behavioral contract and permanent-deletion safety

[PR #28](https://github.com/tofdidthat/1ce-v2/pull/28) is **merged into main** as of 2026-11-04 UTC. This is a source-control fact, **not** proof the feature was independently verified end to end or that a specific production deployment is running it.

- **Delete** soft-deletes a beat or pack (`deleted_at`), hides it from Home/public lists/playback, and revokes publishing, saves, grants and share links. The owner has a **30-day restore window**. Restore does not republish or reinstate revoked grants.
- **Pack cascade:** deleting a pack also soft-deletes beats that were not standalone and have no other live pack; standalone/shared beats are preserved. The parent and cascaded beats share a deletion marker. Restoring the pack revives only beats that were automatically cascaded, not beats the owner had manually deleted.
- **Empty Trash:** owner-only, requires typed `EMPTY TRASH`. The metadata transaction removes trashed projects, checks all remaining beat/pack references and retires only unreferenced **READY** `library_files` with an owner-matching `verified/` key. Foreign keys (`ON DELETE RESTRICT`), owner-level advisory locks and the transactional `v2_r2_delete_jobs` outbox protect shared objects.
- **R2 deletion happens after COMMIT:** worker processes bounded jobs (at most 12 per request), claims jobs with a lease, validates strict owner-scoped keys and records completion or retry state. A partial R2 failure is **not success**; remaining jobs are reported and retried by an explicit subsequent Empty Trash. No automatic expiry purge and no historical orphan sweep are implemented.
- **Do not ever** delete a whole `users/` prefix, a different owner's object, `staging/`, an attached file or an unverified key. An R2 DeleteObject that succeeds cannot be undone by a Git revert, SQL rollback or deploying an older API.

**Required full application acceptance (not established by the infrastructure canary):** test Delete → Trash → Restore and Delete → Empty Trash from the UI and API in an isolated environment with disposable assets. Include pack-only vs standalone/shared beats, shared covers and stems, published/saved/shared links, unauthorized users, player/queue, quota changes, pending/failed R2 jobs, simultaneous project writes, stale session, R2 5xx retry and private media access after soft delete. Independently review destructive SQL and races. Never use real user media for acceptance testing.

## 5. Auth, access and API release health

- Backend login/session credentials belong only in Railway secrets, never Git or frontend code. Google OAuth is wired in the API; it depends on correctly scoped OAuth secrets and redirect URI. Password recovery and signup must not be claimed complete without source and E2E verification.
- `GET /health` should return `200`, `{"ok":true,"service":"1ce-v2-api"}`; `GET /health/db` should return `200`, `{"ok":true,"database":"connected"}`. `GET /auth/me` without a session should return `401`; untrusted browser Origins should be refused. Inspect cookie, CORS, `Cache-Control: no-store`, runtime logs and error rates.
- v2 frontend uses `VITE_API_URL` pointing to the HTTPS API; the API uses a v2-only `DATABASE_URL`, private R2 credentials, `WEB_ORIGIN` and relevant Google OAuth configuration. Never paste any values into documentation.
- Public account profiles accept approved usernames and numeric IDs; avatar identity changes must not alter project covers or ownership. Username constraints and the associated migration are defined by current identity handlers and `007_profile_identity.sql`.
- Before deploy, check actual commit SHA, GitHub CI, Railway staged changes, current deployment/rollback candidates, correct v2 database/bucket and Vercel production configuration. **Merging `main` may automatically trigger Railway/Vercel builds.** A green CI run alone does not prove a successful deployment or browser acceptance.

## 6. Verified release evidence and remaining unknowns

| Evidence (UTC) | Result | Scope and limitations |
| --- | --- | --- |
| [PR #27](https://github.com/tofdidthat/1ce-v2/pull/27), 2026-11-03 | **Merged** | Upload/R2 security, 010/011 quota/lease protections. Source merge is distinct from runtime verification. |
| [PR #28](https://github.com/tofdidthat/1ce-v2/pull/28), 2026-11-04 | **Merged** | Settings Trash, migration 012 and transactional R2 outbox code. |
| [Main workflow 41757434555](https://github.com/tofdidthat/1ce-v2/actions/runs/41757434555), 2026-11-04 | **Success** | Main-branch API/web/dependency and disposable PostgreSQL checks at `9f0bd2c...`. Not a live E2E test. |
| Migration 012 production verification, 2026-11-03 | **Pass (6/6)** | V2 database only; no user-media purge performed as part of applying the schema. |
| Private v2 DB backup, 2026-11-03 | **Archive verified** | Custom PostgreSQL dump in private R2; downloaded/compared; checksum below. |
| Full isolated restore, 2026-11-04 UTC | **`RESTORE_FULL_SUCCESS`** | PostgreSQL 18 disposable container, restored and inspected schema + row counts; no production database writes. |
| Dedicated R2 smoke canary, 2026-11-04 UTC | **`CANARY_SUCCESS_SIBLING_PRESERVED`** | Two uniquely named objects in `onece-s2-smoke-27`; verified delete of one and survival of the other. **Not** a full Trash API/UI test. |

**Backup recovery reference:** R2 private object `db-backups/1ce-v2/20261103T215852Z/postgres-custom.dump`, size **57,413 bytes**, SHA-256 `83dcaa6dc51e580fb4e54d21741b0d24ae488da590f15740b177eb4ead07e0fb`. Backup deployment `ab27fb87-4e14-467d-8bbe-bd6dedbcdedc`; full-restore deployment `1670bf99-b544-49a5-a167-cfd8f5807e3d`. The isolated restore contained 18 public tables, 2 accounts, 11 beats, 1 pack, 23 media records and 24 foreign-key constraints. **This is a point-in-time backup, not continuous backups or a guarantee of zero data loss.** Limit credentials to approved operators; never put a dump in Git.

**Infrastructure R2 canary reference:** disposable bucket `onece-s2-smoke-27`; one-shot Railway deployment `f6b88b41-afab-4ffc-8ee1-c30a16908db5`; PUT, GET, DeleteObject, not-found readback and sibling-object integrity passed. Earlier 403/AccessDenied attempts used the wrong credentials and produced no R2 mutations; scoped test-bucket credentials resolved that. Temporary services were removed.

**Outstanding validation:** independent review of permanent deletion and concurrency behavior, full isolated application-level Trash/Restore/Empty Trash acceptance, and confirmation of the exact Railway/Vercel revisions and manual player/profile/upload checks. Do not silently mark these done because the PRs were merged. CI and GitHub PR state should be rechecked at the then-current HEAD.

**Historical audit:** the full implementation ledgers (old `docs/trash-v2-release.md`, `docs/release-s2-upload-security.md`, S1 rollback checklist, Phase A inventory, identity and playback notes) remain accessible through Git history before this documentation consolidation and through [PR #27](https://github.com/tofdidthat/1ce-v2/pull/27), [PR #28](https://github.com/tofdidthat/1ce-v2/pull/28). This single guide supersedes their old planning checklists; **never execute a historical command without verifying its environment and present applicability**.

## 7. Safe batch, release and rollback protocol

1. **Read before editing:** inspect the current `README.md`, this guide, relevant modules/tests and recent merged PRs. Determine exact product requirement, affected files, permissions, state changes and v1 references. Prefer reusing CSS and components.
2. **Scope the change:** one coherent batch on a dedicated branch. Avoid unrelated frontend files, migration edits or test rewrites. Document intentional changes to product behavior and any unresolved risks.
3. **Validate:** API unit tests, frontend tests, TypeScript typecheck/build, dependency audit and GitHub workflow. Add isolated PostgreSQL/R2 test cases for database/storage behavior. Do not confuse mock tests or successful uploads with production approval.
4. **Before merging/releasing:** verify base/head SHAs and the precise diff, review authorization/storage race paths and assess CI at final HEAD. Obtain explicit user permission for any merge and **separate permission** for runtime/migration changes. Check whether `main` auto-deploys and batch changes to minimize unnecessary deploys.
5. **Post-release smoke:** check Railway API and DB health, Vercel app, sign-in, Home/World, library refresh after uploads, pack and beat context menus, project saves/shares, profile avatar, player/queue/waveform, CORS, privacy and R2/DB pending job counts.
6. **Rollback:** prefer returning API/frontend to a known-good deployment after checking its database compatibility; additive migrations may remain in place. Rollbacks **cannot recreate permanently deleted R2 objects**. If deletion safety is uncertain, disable further destructive operations and preserve evidence before investigating.

### Quick source navigation: v1 visual reference only

The v1 repo `tofdidthat/1ce` is read-only. For a requested visual reference, inspect the actual JSX/CSS there rather than reusing its API endpoints or tokens.

| v1 source (read-only) | Historical responsibility |
| --- | --- |
| `src/workspace/WorkspaceShell.jsx` | Header, Home menu, Discover/World navigation |
| `src/LibraryPage.jsx`, `src/LibraryPage.css` | Library cards, beats/packs, contextual menus |
| `src/GlobalPlayer.jsx`, `src/GlobalPlayer.css`, `src/playback.jsx` | Player bar, queue, Add file behavior |
| `src/upload/LibraryUploadPage.jsx`, `src/upload/LibraryUploadPage.css` | Private library upload UI |
| `src/BeatProfile.jsx`, `src/PublicProfilePage.jsx` | Project details, public profile |
| `src/workspace/ProfileEditor.jsx`, `src/AccountPanel.jsx` | Edit Profile, account Settings |
| `src/routes/AppRouter.jsx` | Legacy app routes |

**Documentation policy:** keep just `README.md` and `docs/architecture.md`. Add new, verified decisions to the appropriate section of this guide; avoid chronological dumps, redundant files and speculative implementation claims. Preserve sensitive operational evidence outside the repo and use Git/PR history to recover older notes.
