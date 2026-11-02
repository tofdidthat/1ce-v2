# Protocol for complete change batches — read before changing 1CE v2

> **Mandatory working agreement (2026-11-02).** Whenever the user requests a complete feature, a refactor, several changes, or a production correction, **first read this entire `docs/architecture.md` and the relevant behavior/contract documentation** (notably `docs/refactor-phase-a-inventory.md`, `docs/shared-playback-v2.md`, `docs/reactive-refresh-v2.md`, and related migration/rollout notes). Compare the guide against the live code, the current branch, tests and deployment state; update this document when a decision or phase status changes **before implementing the feature**. Do not rely on historical chat descriptions or stale snapshots to declare work complete.

## Batch / deployment protocol

1. **Inventory and behavior:** identify user-visible acceptance criteria and affected UI, API, auth, SQL schema, R2, player, Saves/Catalog and permissions; inspect current existing methods before adding routes, tables or state. Document changes to behavior and architecture, including expected deletion and optional-asset behavior.
2. **Plan and isolation:** group related work into **one coherent batch**, in an isolated v2 branch, and prefer one reviewed PR and one production deploy per approved batch. Preserve v1 independence and original project/media IDs. Avoid redundant R2 copies and new database paths without justification.
3. **Implement and verify:** batch commits rather than deploying at every intermediate change; use GitHub Actions for API tests, frontend tests, TypeScript/build and regression checks. Test both ownership and cross-user access, missing optional cover/stems, navigation and persistent-player preservation. Be honest when live end-to-end testing cannot be done.
4. **Release gate:** review migration and runtime dependencies, confirm CI green, inspect diff and verify target branch/commit. **Do not merge or deploy unless the user authorizes this batch's publication**, or explicitly requests immediate release. On approval, deploy API/migrations in safe order then frontend, check Vercel READY/alias, Railway health and database, and report incomplete verification.
5. **Economize Vercel:** automatic previews for v2 are disabled to conserve Hobby deployment quota; **do not re-enable without permission**. Prefer CI-only validation on feature branches, no manual deployments for each commit and no duplicate retry loops. One deployment for a complete reviewed batch; handle build quota limits transparently.
6. **Documentation before code, then ledger:** maintain an accurate implemented vs validated vs pending phase ledger below, and update acceptance scenarios, docs/tests, or explicit decisions within the same PR. Before every future complete request, check this protocol **and behavioral contracts** again.

**Binding boundaries:** do not change/download stems or unrelated features without request; never change v1 or its database/bucket. Published and explicitly shared permissions remain server-authoritative; saving is not an authorization grant. Preserve a single active player and original project identities. No destructive action without explicit user confirmation in the interface and safe server checks.

---

# 1CE v2 — Architecture and Refactoring Plan

> Status: living architecture document. Read section 0 for the latest implementation and verification ledger. Sections 5–7 are target behavior and remaining migration gates; implemented milestones are separately recorded in section 0.

## 0. Progress ledger — current phase and completed work (2026-11-02)

The refactor is **in progress, spanning phases A–D**. **We are currently prioritizing C (shared frontend behavior and project actions), while B and D still have consolidation debt.** Phase E has not been completed. These statuses distinguish code integrated on `main`, automated tests, deployment, and end-to-end verification:

| Phase | Implemented and merged in v2 | Still missing before exit |
| --- | --- | --- |
| **A — Inventory and tests** | Inventory and risk/contract matrix recorded; API fixture-based tests (28 passed on latest verified CI); second-account sharing/Saves behavior manually exercised; profile/avatar and playback bug reproduction; cross-tab refresh tests (3 passed). | Full systematic owner/public/shared/anonymous live DB + R2 regression matrix; explicitly approve final stems policy; complete contract/behavior inventory and sign off A exit. |
| **B — Canonical project resolver/media policy** | `project-media.js` shared authorization behind existing private/public routes; `/api/public/play/:owner/:kind/:id` project manifests and `/api/public/audio/:owner/:fileId` authorized streaming with byte ranges; original files and pack order preserved. Deployed and public beat/pack manifests smoke-tested. | Consolidate duplicate cover routes, typed canonical manifest for all consumers, verify private/shared access and deletion/revocation against live isolated v2 PostgreSQL and private R2. Stems remain interim owner-only. |
| **C — Shared frontend project/media layer** | Settings username/avatar merged and deployed with migration 007; public profile Catalog/Saves; cross-owner Play controls; project/save/publish flags and cross-tab/focus refresh; upload Library refresh merged and Vercel READY. | Shared typed card/media components; eliminate cover fallback duplication; actual project context actions (Add to, Rename, Change cover, Delete) with documented semantics, tests, auth and immediate invalidation. **This is the active feature batch.** |
| **D — Persistent player / shared projects** | Library-owned audio player kept mounted across `/app/*` view transitions; cross-user and `/u/:username` playback through shared manifests, correct ordered pack references and R2 ranges; CI passed. | Extract controller above route/view lifetime; verify transitions between `/u/*` and `/app/*`, queue behavior after project edits/deletion, full multi-account manual playback scenarios. |
| **E — Consolidation and release** | Partial cleanup/test documentation, merge gates and one-deploy-per-batch process; Vercel previews disabled and CI used independently. | Full route/state/cover consolidation, error/caching/memory review, staging and production end-to-end acceptance matrix and written Phase E sign-off. |

**Previous integrated batches:** PR #1 Settings identity (migration 007 + deployment), PR #2 secure shared playback (28 API tests), PR #3 scoped refresh without F5 (28 API + 3 frontend tests; Vercel production READY on commit `32b11d05`). **Latest observed Railway build for PR #3 was still pending while its existing API remained healthy**; do not infer an unobserved final deployment outcome. The user must explicitly approve final deployment of each new batch.

**Context-menu action decision for this batch:** "Add to > existing pack" adds **references** to owned original beats; "New project" creates a **new pack project** referencing those beats (never a nested pack or a media duplicate). Applying Add to a pack means selecting its existing beats, not nesting the pack. Changes to names/covers mutate metadata only; optional cover may remain null. Deleting a pack removes only pack relationships and its project metadata, not source beats/files. Deleting a beat requires confirmation, enforces ownership, revokes its public/save/share links and detaches it from packs before deleting its metadata; actual R2 objects are **not** deleted in this batch to avoid destroying shared/reused objects. Retained unreferenced objects need a future cleanup policy. Clear confirmation text must explain these effects. Download and Stems remain untouched.

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
- Library and Profile still have separate view-specific flags, but PR #3 added scoped mutation notifications, focus revalidation and cancelable refetches. Profile play requests now carry canonical owner/kind/project identity to a shared API manifest, including cross-owner playback; the Library-mounted player remains a temporary architectural coupling.
- **Phase B incremental source/deployment:** `apps/api/src/project-media.js` centralizes media-file lookup and permissions for owner audio/cover, public cover, public project playback manifests and cross-owner audio streaming. Published/shared packs authorize original member audio/covers; stems remain owner-only. Separate HTTP cover routes/frontend fallbacks remain debt. Fixture-backed tests and GitHub CI have passed; a public manifest smoke test has been performed, but the entire permission matrix has not been verified against live PostgreSQL/R2.

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

Sections 5–7 describe remaining target architecture and exit criteria; section 0 records what has already been implemented, tested and deployed.