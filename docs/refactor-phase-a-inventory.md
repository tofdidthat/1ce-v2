# Refactoring phase A — API and media inventory

Status: **phase A inventory plus initial phase B extraction**, 2026-11-02. This document records current source and remaining test gaps. No deployed end-to-end or live database verification is claimed.

Source of truth: [architecture.md](architecture.md).

## Existing HTTP contracts (retain until callers are migrated)

| Method and route | Current handler | Consumer / purpose | Limitation |
| --- | --- | --- | --- |
| GET `/api/library/files/items` | `library-files.js` | Library lists owner's beats/packs | Owner-only; beat includes audio, cover and stems IDs |
| GET `/api/library/files/cover/:fileId` | `library-files.js` | Library cover and player | Owner-only adapter now uses shared `project-media.js` media lookup; file ID remains route parameter |
| GET `/api/library/files/audio/:fileId` | `library-files.js` | Library player and waveform | Owner-only adapter now uses shared `project-media.js`; byte-range support unchanged |
| GET `/api/library/files/pack-tracks/:packId` | `library-files.js` | Library pack playback | Owner-only; now returns each beat's audio, cover **and optional stems** IDs |
| POST `/api/library/files/beats` | `library-files.js` | Create beat | Checks ownership, type and readiness of audio/cover/stems |
| POST `/api/library/files/packs` | `library-files.js` | Create pack | References owned beats; optional pack cover |
| POST `/api/library/files/init` and POST `/api/library/files/:id/complete` | `library-files.js` | Private R2 upload | Hash/metadata verification; no duplicate media on save/publish |
| GET `/api/public/profile/:userId` | `public-profiles.js` | Profile Catalog/Saves | Saves filtered by viewer; Catalog contains published metadata only |
| GET `/api/public/mine` | `public-profiles.js` | Save/publish flags | Separate state requests in Library/Profile |
| POST/DELETE `/api/public/save/:owner/:kind/:id` | `public-profiles.js` | Save relationship | Does not duplicate project; POST authorization should also verify project existence |
| POST/DELETE `/api/public/publish/:kind/:id` | `public-profiles.js` | Catalog membership | Owner-only |
| POST `/api/public/share/:kind/:id` and POST `/api/public/redeem/:token` | `public-profiles.js` | Share access | Redeem grants project access, no media copy |
| GET `/api/public/cover/:owner/:fileId` | `public-profiles.js` | Profile cover | Uses shared `project-media.js` authorization; cache now private/no-store; duplicate HTTP route remains pending consolidation |

**No unified cross-owner audio delivery contract** was identified in the inspected handlers. Do not implement cross-owner playback by fetching owner-only audio IDs or by making the R2 bucket public. No project-aware stems download contract was identified.

## Current frontend dependencies

- `apps/web/src/library-items-v2.tsx`: owner Library items; owner cover/audio URLs; pack-tracks; player/queue/waveform; save and publish actions.
- `apps/web/src/public-profile-v2.tsx`: profile and mine endpoints; public cover endpoint; owner cover endpoint as a fallback; separate save/publish/play-button state.
- `apps/web/src/workspace-v1.tsx`: keeps Library mounted while navigating so player remains alive; passes play requests from Profile. This is a temporary coupling.
- Project identity currently crosses screens as `kind + id` in some UI state; target identity is `ownerId + kind + projectId`.

## Data integrity observations

- `library_beats`: audio ID required; cover/stems IDs optional. `library_packs`: optional cover; `library_pack_beats`: ordered references.
- `v2_public_projects`, `v2_public_saves`, `v2_project_access`, `v2_project_share_links` hold relationships, not copies of R2 assets.
- The public Profile response exposes cover ID but not a canonical media manifest; the owner Library response includes audio and stems IDs.
- `pack-tracks` now selects audio, cover and optional stems IDs for each original beat; downstream code may still use pack cover as a visual fallback.
- File ID authorization and project ID authorization are currently separate code paths. This is the main refactoring boundary.

## Risk register (observations to validate, not production incident claims)

1. **Private cover missing in Profile:** owner Library cover and Profile public cover have different access logic; Profile's fallback hides which path failed.
2. **Saves missing or stale:** Library/Profile independently fetch `mine`; profile saves are permission-filtered; state refresh differs between views.
3. **Shared playback:** Profile dispatches a project ID to the Library player, which searches the viewer's own Library list.
4. **Authorization consistency:** owner and public media use the same file authorization service, but authorization remains keyed by file ID at HTTP boundaries; full canonical project manifests, cross-owner audio routes and stems download policy are pending.
5. **Caching:** `/api/public/cover` now sends `Cache-Control: private, no-store`; verify behavior and regressions in deployed environment.
6. **Existence validation:** POST Save authorization can succeed for a user's own nonexistent UUID; a saved relationship can become orphaned.
7. **Object URL lifecycle:** Profile creates/revokes cover blob URLs independently of Library's cover component.

## Regression test matrix to implement before removing endpoints

| Scenario | Owner | Public viewer | Shared authenticated viewer | Unauthenticated visitor |
| --- | --- | --- | --- | --- |
| Private beat metadata | allow | deny | allow with grant | deny |
| Private beat cover | allow if present | deny | allow with grant | deny |
| Private beat audio | allow | deny | allow with grant | deny |
| Private beat stems | policy decision pending | deny | policy decision pending | deny |
| Published beat metadata/cover/audio | allow | allow | allow | allow |
| Published beat stems | policy decision pending | policy decision pending | policy decision pending | policy decision pending |
| Own unpublished save | allow and visible in Saves | not visible | grant-dependent | not visible |
| Pack tracks | original ordered beat IDs | public policy | grant-dependent | public policy |
| Missing optional cover/stems | explicit null, no failure | explicit null | explicit null | explicit null |
| Deleted project / mismatched asset | deny, no dangling media | deny | deny | deny |

Additional tests: 206/416 range requests; credentials/cookies; cache headers; stale saves; publish/unpublish; same ID and asset references across Library/Catalog/Saves; navigation preserving player; revoked grants when revocation semantics are defined.

## Phase A next actions

1. Capture actual API responses and status codes in an isolated v2 test environment; never use production v1 credentials.
2. Decide and document stems access policy (owner-only versus authorized share/public download).
3. Define the canonical typed project manifest and error semantics without adding HTTP routes.
4. Add API-level tests using isolated fixtures/mocked storage; verify authorization before streaming.
5. Only then start phase B: extract shared project resolver and reuse it behind existing routes before retiring anything.

**Guardrail:** No HTTP endpoints or database tables were added in the initial extraction. Existing URLs remain supported.

## Implementation ledger — first incremental extraction (2026-11-02)

**Implemented in source (not yet end-to-end verified):**

- Added `apps/api/src/project-media.js` as the shared media-file lookup and authorization service. Ready files must match owner and kind; owner retains compatibility access to unattached uploads.
- Non-owner cover/audio access requires a relationship to an existing beat or pack that is published or explicitly shared; saved status alone is not authorization.
- When a pack is published or explicitly shared, its member beats' original audio and covers are eligible under the pack's permission. This does not publish each beat individually.
- **Interim stems restriction:** owner-only. No stems download endpoint has been created; the final sharing/download policy still needs approval.
- Wired both existing cover handlers and the existing Library audio handler to the shared lookup, with no new routes. `/api/public/cover` now uses private/no-store caching.
- Pack-tracks now includes the original beat `stems_file_id` alongside `audio_file_id` and `cover_file_id`, without generating files.
- Added `apps/api/test/project-media.test.js`, `npm test --prefix apps/api`, and the `.github/workflows/api-tests.yml` test job.

**Pending before calling phase A/B complete:**

- Confirm GitHub Actions test results and run integration tests against a disposable **v2** PostgreSQL schema with mocked R2; current tests use deterministic query-result fixtures, not a real PostgreSQL SQL parser.
- Validate owner/private/published/shared covers and audio in a deployed v2 environment, including real cross-origin cookies and error responses.
- Approve the final stems download policy; add project-aware media manifest and cross-owner audio consumption without proliferating HTTP routes.
- Consolidate frontend cover loading and player state only after backend contracts are verified.
- Investigate Vercel/Railway deployment status independently of source commits.
