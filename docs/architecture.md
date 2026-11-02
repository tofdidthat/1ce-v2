# 1CE v2 — Architecture and Refactoring Plan

> Status: living architecture document. The **Current implementation** sections describe the repository as inspected on 2026-11-02. The **Target architecture** and **Migration plan** sections are decisions and proposals, **not implemented features**. Update this document alongside architectural changes.

## 1. Mission and non-negotiable boundaries

1CE v2 is an independent rebuild of 1CE. Its goal is a maintainable, secure music-project workspace with Library, Profile/Catalog, Saves, sharing and a persistent player.

- **Never modify** the v1 `1ce` or `1ce-server` repositories or their production data.
- The v2 API, PostgreSQL database, R2 bucket, credentials and deployment configuration must remain isolated from v1.
- Preserve approved identity compatibility during migration without reusing production sessions or OAuth tokens.
- All user-facing views must refer to the **same underlying project ID**. Publishing, saving, sharing and queueing must not clone a project or duplicate its media objects.
- No new API route, parallel state store, fallback chain or component should be introduced without checking existing contracts and documenting the reason.
- Prefer incremental, tested migrations to broad rewrites.

## 2. Repository and runtime

| Layer | Current location | Responsibility |
| --- | --- | --- |
| Frontend | `apps/web` | React + Vite + TypeScript, views and interaction |
| API | `apps/api` | Node.js, sessions, authorization, metadata and media delivery |
| Database | Isolated v2 PostgreSQL | Users, projects, project membership, publishing, saves, access |
| Object storage | Private v2 Cloudflare R2 | Original audio, cover and stems files |
| Documentation | `docs/` | Current contracts, decisions and operational instructions |
| Historical scripts | `history/` | Previously applied migrations and records; not runtime code |

Frontend deployment: v2 Vercel project. API deployment: v2 Railway service. Deployment configuration and verification are separate from source commits.

The original Phase 1 scaffold (landing, placeholder auth, non-operational Library and no R2) is historical scope, not an accurate description of the current application.

## 3. Canonical domain model — target invariant

**A beat is one project with one stable ID and a coherent media manifest.** The manifest contains:

- `id`, `ownerId`, `kind: "beat"`, title and other metadata;
- **required** audio reference (`audioFileId`);
- **optional** cover reference (`coverFileId`);
- **optional** stems reference (`stemsFileId`);
- availability/status of each asset and authorization derived from the project.

A missing optional cover or stems file is valid and must be represented explicitly, not mistaken for a failed download. The audio, cover and stems **travel together as references to one beat** across all screens and actions; this does **not** mean downloading every file on each card render. Clients request individual media only when needed, through the same project-aware access policy.

A pack is one stable project ID containing ordered references to existing beats. It may have its own optional cover. A pack does not own copies of the beats' audio, covers or stems. The player uses the pack's ordered beat references and each beat's own manifest; any pack-cover fallback must be a **single documented presentation rule**, not ad-hoc data mutation in each view.

```text
Beat (stable project ID, owner)
 ├─ audioFileId  → private R2 object (required)
 ├─ coverFileId  → private R2 object (optional)
 └─ stemsFileId  → private R2 object (optional)

Pack (stable project ID, owner)
 ├─ coverFileId  → private R2 object (optional)
 └─ ordered beat IDs → original Beat manifests

Library / Catalog / Saves / Shared link / Queue / Player
                  ↓
       same canonical project identity
                  ↓
       one metadata + authorization policy
                  ↓
       original media references in private R2
```

**Identity key:** `(ownerId, kind, projectId)` across cross-user references. Project UUIDs remain unchanged; owner and kind are explicit to avoid ambiguity.

## 4. Current implementation (verified in repository)

- `apps/api/src/library-files.js` handles private library files, project creation/listing, cover/audio delivery and pack tracks. Existing `library_beats` records reference `audio_file_id`, `cover_file_id`, `stems_file_id`; `library_packs` reference `cover_file_id`, and `library_pack_beats` orders membership. Pack track responses now return each beat's original audio, cover and optional stems IDs.
- `apps/api/src/public-profiles.js` handles published projects, saves, share-link redemption, access grants and an existing public-cover HTTP route. Related schema is recorded in `history/database/004_public_profiles.sql`.
- `apps/web/src/library-items-v2.tsx` loads Library items, media and pack tracks and currently owns much of the persistent player behavior.
- `apps/web/src/public-profile-v2.tsx` loads Catalog and Saves and currently uses different cover-request paths for owner and visitor, including a fallback. This is **temporary implementation debt**, not the target contract.
- Library and Profile currently maintain some independent save/publish and play-related state. A Profile play request is forwarded to Library's player, whose project lookup is currently tied to the viewer's Library items; shared projects may therefore require a different resolution path.
- **First phase B extraction in source:** `apps/api/src/project-media.js` now centralizes media-file lookup and permissions behind existing owner audio/cover and public cover endpoints. A published/shared pack can authorize access to its original members' audio/covers. Stems are provisionally owner-only. The separate HTTP cover routes and frontend fallback remain migration debt. `apps/api/test/project-media.test.js` provides fixture-backed unit tests, with execution and deployment verification still pending.

Do not treat the existing routes as an approved long-term API design simply because they exist.

## 5. Target backend contract — resolve project once

Before adding or changing endpoints, inventory all existing callers and decide which current endpoints can be consolidated or retained with consistent semantics.

Introduce a **shared project-resolution and authorization service** inside the API (a service/module, not necessarily a new HTTP route) responsible for:

1. Resolve `(ownerId, kind, projectId)` against the original beat or pack and verify it still exists.
2. Resolve the complete project metadata/manifest, including audio, cover, stems and ordered pack members.
3. Apply a **single access policy** to project metadata and each media operation.
4. Validate media ownership, file kind, readiness and association with the authorized project.
5. Return predictable missing/forbidden/unavailable outcomes; do not silently switch to unrelated files.
6. Keep R2 object keys and credentials server-side; never expose private bucket credentials.

**Access rules (target):**

| Actor | Private project | Published project | Explicitly shared project |
| --- | --- | --- | --- |
| Owner | Full project and permitted assets | Full project and permitted assets | Full project and permitted assets |
| Authenticated non-owner | No access by default | Allowed according to public project policy | Allowed for explicitly granted project |
| Anonymous visitor | No access | Allowed only for intentionally public assets | No access |

Publication and share grants must be checked consistently for **audio, cover and stems**; access to one asset must not accidentally bypass authorization for another. Stems downloads may need an explicit product policy (for example, owner-only vs shared) **before implementation**; do not assume that public streaming automatically grants stems-download rights.

The endpoint design is a **decision gate**, not an instruction to create another route now:

- Prefer consolidating existing `/api/library/files/...` and `/api/public/...` media behaviors behind shared service logic.
- Select and document **one canonical project-aware media contract** (or a clearly justified minimal set) after checking backwards compatibility, authentication and callers.
- Remove redundant cover-delivery/fallback paths **only after** callers migrate and tests pass.
- Use the same resolver for Library, Catalog, Saves, share links and playback, including projects owned by other users.
- For private images and media, use consistent session handling, response status and cache policy. Avoid public caching of authorization-dependent content.

**No duplicate R2 uploads or media records** when a project is published, saved, shared or played.

## 6. Target frontend responsibilities

- **Project data layer:** one typed project/manifest contract and reusable fetch/query functions; one source of truth for published/saved state with explicit invalidation after mutations.
- **Project card:** shared cover, play/pause control, title, status and context actions for Library, Catalog and Saves; layout variants may differ, but icon sizing and behavior come from shared primitives.
- **Cover component:** accepts a project identity/manifest, uses the canonical authorized media contract, and handles absent cover, loading, error, cancellation and object-URL cleanup. No view-specific endpoint fallback.
- **Persistent player:** one playback controller outside view-specific mounting, with canonical `(ownerId, kind, projectId)` identity, active beat, pack track order, queue, play/pause, progress and errors. Navigation must not reset playback.
- **Profile and Library:** views request actions from the shared player and project data layer rather than maintaining competing playback truth.
- **Saves:** references to original projects, including the user's own projects. Saving/un-saving does not create media copies. The owner must be able to see their own saved private projects; other viewers see only projects they are authorized to see.
- **Sharing:** grant access to an original project; redemption must not duplicate it. Revocation semantics and access persistence need explicit policy before implementation.

## 7. Refactoring plan — ordered, incremental

### Phase A — Inventory and tests (no behavior change)
- Map current routes, consumers, database references, object storage reads, cover loading, playback, saves and authorization.
- Record actual request/response contracts and reproduce the missing-cover and missing-save cases using published, private-own and shared projects.
- Add regression tests for project identity, asset associations, auth outcomes and view navigation.
- Decide stems-access policy and document it.

**Exit:** documented dependency map, reproducible failures and agreed contract.

### Phase B — Canonical project resolver and media policy
- Extract project lookup, manifest assembly and authorization into shared API services.
- Preserve current endpoints initially as thin adapters where necessary; do not duplicate authorization logic.
- Add automated tests for audio, cover, stems, missing optional assets, pack membership and access levels.
- Choose canonical endpoint semantics, then migrate callers safely.

**Exit:** all media decisions use the same project-aware resolver; no divergent cover permissions.

### Phase C — Shared frontend project/media layer
- Define shared TypeScript models and request helpers for project identities and manifests.
- Replace per-view cover fallback logic with one cover component and one authorized request strategy.
- Centralize saved/published state, mutation feedback and refresh/invalidation.
- Reuse card and play/pause UI between Library and Profile.

**Exit:** the same project renders the same media and actions across Library, Catalog and Saves.

### Phase D — Persistent player and shared projects
- Move playback state to a top-level controller/provider, independent of Library visibility.
- Resolve playable projects by canonical identity rather than only by the current user's Library arrays.
- Keep beat audio, cover and optional stems linked through the same manifest during queue and pack playback.
- Verify navigation, play/pause state, pack order, switching projects and shared-project playback.

**Exit:** one player, consistent state and cross-view/cross-owner playback for authorized projects.

### Phase E — Consolidation and cleanup
- Migrate remaining consumers, remove redundant media endpoints/fallbacks and obsolete state only after tests pass.
- Review query efficiency, R2 reads, caching, cancellation, memory cleanup and error visibility.
- Update documentation, perform deployment checks and verify behavior in Vercel/Railway staging before release.

**Exit:** no duplicate business logic or unjustified endpoint paths; tested, documented contracts.

## 8. Required acceptance scenarios

1. Owner uploads beat with audio + cover + stems: the same beat ID and all three original asset references remain consistent in Library, Catalog (when published), Saves (when saved) and player.
2. Owner uploads beat with audio only: playback works; missing cover/stems show an intentional empty state.
3. Owner saves own unpublished beat or pack: it appears in Saves with its original cover and identity.
4. Owner publishes/unpublishes a project: Catalog visibility changes; no R2 objects or project IDs are duplicated.
5. Authorized recipient redeems private share: original project metadata and permitted cover/audio load; unauthorized user cannot fetch private assets by guessing IDs.
6. A public project renders the same cover and plays the same audio from Library/Profile/Saves wherever the viewer has access.
7. Pack playback preserves ordered original beat IDs, correct track media and defined pack-cover behavior.
8. Navigating between Library and Profile does not interrupt playback or desynchronize play/pause controls.
9. Saving/un-saving changes only relationships; the original audio/cover/stems stay intact.
10. API rejects mismatched file IDs, wrong owner/kind, deleted projects, unauthorized access and non-ready objects.
11. Stems behavior follows the explicitly approved access/download policy.
12. No changes to v1 infrastructure, repositories or data.

## 9. Engineering rules and documentation maintenance

- Diagnose with a reproducible case and API status before adding fallbacks.
- Keep authorization server-side, central and covered by tests.
- Do not create routes solely to solve one view's presentation issue.
- Avoid unnecessary duplicate components, R2 objects, database rows and player state.
- Separate **implemented**, **planned** and **verified in deployment** claims.
- For each refactoring phase: document design decision, change smallest coherent unit, run tests/build, validate in staging and only then remove compatibility code.
- Update this file and related API/schema documentation whenever a contract changes.

## 10. Historical references

- `README.md`: repository structure and deployment overview (some setup notes may be historical).
- `docs/auth-deployment.md`: isolated authentication deployment notes.
- `history/database/004_public_profiles.sql`: recorded publication, save and access relationships.
- `apps/api/src/library-files.js`, `apps/api/src/public-profiles.js`, `apps/api/src/project-media.js`: current API implementations and shared media authorization.
- `docs/refactor-phase-a-inventory.md`: route matrix, risks, initial implementation ledger and remaining verification gates.
- `apps/web/src/library-items-v2.tsx`, `apps/web/src/public-profile-v2.tsx`: current view and playback implementations.

The plan above is **not** a claim that the refactor has been implemented.