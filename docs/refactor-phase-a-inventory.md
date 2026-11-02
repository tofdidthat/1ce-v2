# Refactoring phase A — API and media inventory

Status: **initial repository audit**, 2026-11-02. This document records the current code and identifies test gaps. It does not claim that the API or UI has been tested in a deployed environment.

Source of truth: [architecture.md](architecture.md).

## Existing HTTP contracts (retain until callers are migrated)

| Method and route | Current handler | Consumer / purpose | Limitation |
| --- | --- | --- | --- |
| GET `/api/library/files/items` | `library-files.js` | Library lists owner's beats/packs | Owner-only; beat includes audio, cover and stems IDs |
| GET `/api/library/files/cover/:fileId` | `library-files.js` | Library cover and player | Owner-only; looks up file, not project |
| GET `/api/library/files/audio/:fileId` | `library-files.js` | Library player and waveform | Owner-only; byte-range support; looks up file |
| GET `/api/library/files/pack-tracks/:packId` | `library-files.js` | Library pack playback | Owner-only; track payload omits stems ID |
| POST `/api/library/files/beats` | `library-files.js` | Create beat | Checks ownership, type and readiness of audio/cover/stems |
| POST `/api/library/files/packs` | `library-files.js` | Create pack | References owned beats; optional pack cover |
| POST `/api/library/files/init` and POST `/api/library/files/:id/complete` | `library-files.js` | Private R2 upload | Hash/metadata verification; no duplicate media on save/publish |
| GET `/api/public/profile/:userId` | `public-profiles.js` | Profile Catalog/Saves | Saves filtered by viewer; Catalog contains published metadata only |
| GET `/api/public/mine` | `public-profiles.js` | Save/publish flags | Separate state requests in Library/Profile |
| POST/DELETE `/api/public/save/:owner/:kind/:id` | `public-profiles.js` | Save relationship | Does not duplicate project; POST authorization should also verify project existence |
| POST/DELETE `/api/public/publish/:kind/:id` | `public-profiles.js` | Catalog membership | Owner-only |
| POST `/api/public/share/:kind/:id` and POST `/api/public/redeem/:token` | `public-profiles.js` | Share access | Redeem grants project access, no media copy |
| GET `/api/public/cover/:owner/:fileId` | `public-profiles.js` | Profile cover | Separate authorization query; cache marked public despite session-dependent access |

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
- `pack-tracks` currently selects audio and cover IDs but not stems; downstream code may use pack cover as a fallback.
- File ID authorization and project ID authorization are currently separate code paths. This is the main refactoring boundary.

## Risk register (observations to validate, not production incident claims)

1. **Private cover missing in Profile:** owner Library cover and Profile public cover have different access logic; Profile's fallback hides which path failed.
2. **Saves missing or stale:** Library/Profile independently fetch `mine`; profile saves are permission-filtered; state refresh differs between views.
3. **Shared playback:** Profile dispatches a project ID to the Library player, which searches the viewer's own Library list.
4. **Authorization consistency:** public cover has project-level grants, owner audio is file-level, and stems access is not yet unified.
5. **Caching:** `/api/public/cover` currently sends `Cache-Control: public,max-age=120` for potentially private content; change requires security review and regression tests.
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

**Guardrail:** No endpoints or database tables are added as part of this inventory.
