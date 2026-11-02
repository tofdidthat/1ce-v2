# 1CE v2 — Phase C handoff / start here (living source of truth)

> **Updated:** 2026-11-02. **Priority:** finish **Phase C (shared frontend project/data architecture)** before undertaking the Phase D player-controller extraction or Phase E cleanup. The reader must verify GitHub `main`, open PRs, Actions and deployments: branch/PR states below are a dated snapshot, not permanent truths.
>
> This file is intentionally self-contained. An AI/new developer must be able to resume WITHOUT chat history, saved memory or credentials. Read this, then `docs/architecture.md`, `docs/refactor-phase-a-inventory.md`, `docs/shared-playback-v2.md`, `docs/reactive-refresh-v2.md`, and inspect **actual current code** before a change.

## One-minute operational handoff

1. **Repository:** `tofdidthat/1ce-v2`; production deploy branch `main`. Frontend: React/TypeScript/Vite in `apps/web` (Vercel project `1ce-v2`). Backend: Node in `apps/api` (Railway service `1ce-v2`), its own PostgreSQL, private v2 Cloudflare R2. **Never touch v1** (`1ce`, `1ce-server`, v1 DB/bucket).
2. **Last confirmed integrated:** PR #1 account identity; #2 authorized shared playback; #3 refresh without F5; #4 permanent owner project actions; #5 shared menu/card/cover/request helper; #6 Add-to chevron layout. PR #6 merged at `8663903a4e256c47e3c185722c5491183b79a747`; Vercel build observed READY, Railway build was in progress at last observation (check again). No future AI should treat old progress tables as more authoritative than Git.
3. **Current working branch:** `refactor/v2-phase-c-data-and-handoff` (initial work documented here). Goal: owner-scoped **single source of truth for project saved/published flags**, deduplicated refresh/mutations across Library/Profile, then remaining Phase C items. Work in batches and PRs, no deploy/merge without explicit approval. Vercel preview builds intentionally disabled to save quota. GitHub Actions performs API tests, Node web tests, `tsc -b && vite build`.
4. **Immediate implementation diagnosis:** `library-items-v2.tsx` and `public-profile-v2.tsx` independently `GET /api/public/mine`, hold separate sets and mutation handlers. `ProjectCardV2`, `ProjectCoverV2`, `ProjectContextMenuV2`, `ProjectActionDialogV2` and `project-requests-v2.ts` already exist. `data-refresh-v2.ts` delivers **invalidation only**, not canonical state. `WorkspaceV2` in `workspace-v1.tsx` mounts Library invisibly to preserve the player. Do NOT move/unmount that player during Phase C.
5. **Check status before declaring complete:** CI green at exact PR head; run manual browser tests owner / different logged-in user / anonymous; validate public/private cover/audio through authorized routes; Vercel and Railway health only if a release is approved. An automated source-code regex test is NOT a visual or real-DB E2E test.

## Architecture invariants (non-negotiable)

- Beat = stable project UUID with required original audio ID, optional cover and stems IDs. Pack = stable UUID with *ordered references to existing beats*, never nested media copies. Identity across screens and accounts: `(ownerId, kind, projectId)`; project/file IDs do not change on save/publish/share.
- **One shared component/service per responsibility**, reused in Library, Profile/Catalog, Saves and applicable shared-link views. Different layout is a prop/variant, not a second implementation. Keep UI components presentational; keep auth/data/mutations in explicit services/controllers.
- Server is authoritative for ownership, publication, share grants, downloads and media access. **Saving does not grant access.** No client-side cached state can override a 401/403/404. Missing optional cover/stems are valid, not an excuse to fetch unrelated objects.
- All physical media are private v2 R2 originals. Never copy/delete R2 objects as part of a card/pack/save/publish action. Owner Delete (beat/pack) is server-checked, confirmed UI action; pack deletion preserves beats; beat deletion revokes related references.
- One active audio player and queue: currently owned by the mounted Library component; refreshes must not reset playback, replace the `<audio>` element, mutate queue identity, or break range streaming. Extract later in Phase D after C sign-off. Do not implement Download/Stems until specifically requested.

## Component map and ownership

| Responsibility | Canonical code today | Phase C work |
| --- | --- | --- |
| Navigation/container | `apps/web/src/workspace-v1.tsx` `WorkspaceV2` | Host one viewer-scoped project-data provider above Library+Profile; preserve mounted player |
| Library view | `apps/web/src/library-items-v2.tsx` | Consume shared flags, queries/selectors, mutation results; keep player controls/view layout |
| Profile Catalog/Saves | `apps/web/src/public-profile-v2.tsx` | Consume same viewer flags and normalized projects; keep profile layout and owner/other-user permissions |
| Project card | `project-card-v2.tsx` | Already shared; visual variants library/profile |
| Cover | `project-cover-v2.tsx` | Already shared `GET /api/public/cover/:ownerId/:fileId` with session; extend only after security review |
| Right-click actions | `project-context-menu-v2.tsx` | Already shared. Add-to chevron alignment fixed in PR #6 |
| Mutating dialog | `project-action-dialog-v2.tsx` | Already shared; uses `/api/library/projects/*`; backend remains authoritative |
| Save/publish/share HTTP | `project-requests-v2.ts` | Already shared transport. Use common viewer state mutation layer to avoid duplicate local sets |
| Refresh transport | `data-refresh-v2.ts` | Emits scoped local/cross-tab invalidations; focus events; no auth or authoritative cache |
| Playback manifests | `apps/api/src/project-media.js`, `/api/public/play/:owner/:kind/:id` | Keep untouched for C; Phase D will move controller |
| Legacy private/library API | `apps/api/src/library-files.js` | Keep backwards-compatible; canonical API consolidation is B/E, not C |

### Frontend data contract (target)

- One **viewer-scoped** project flags store or context, above Library and Profile, keyed to the authenticated viewer ID. It fetches `GET /api/public/mine` **once per refresh**, holds saved keys `ownerId:kind:projectId` and own publication keys `kind:projectId`, and exposes `isSaved`, `isPublished` and shared mutation methods.
- On a successful Save/Unsave or Publish/Unpublish: update the viewer store once, emit the appropriate scoped `notifyV2DataChanged`, then revalidate from the server. On error keep the previous state and display feedback. Cross-tab/focus signals trigger server refetch; no polling. Abort/ignore stale requests on viewer changes or unmount. Never share flags across accounts.
- Profile Catalog/Saves lists and Library items are **different server resources**; they may keep view-specific metadata while consuming the *same* flag state. Do not conflate a project appearing in Catalog with being saved. All list changes must revalidate via existing scopes. Optimistic removal from a list is a presentation detail only.
- Do **not** introduce a parallel React Query/Zustand store or global persistence solely for this increment. Avoid exposing R2 keys or credentials. If a shared query cache is introduced later, document invalidation, TTL, ownership, permission revocation, and which view owns the request.
- `ProjectCoverV2` owns image fetch/abort/blob revocation; `ProjectCardV2` owns card play affordance; the view supplies the playback callback and on-context-menu callback. The player itself remains mounted in Library temporarily.

## Phase C target sequence and exit criteria

Status legend: **done/merged**, **working**, **pending**, **blocked by product decision**.

| Item | Status at handoff | Definition of done |
| --- | --- | --- |
| C1. Reusable menu/card/cover/dialog/HTTP helpers | **Done/merged (#4–#6)** | Same actions/visuals in Library and Profile; correct ownership |
| C2. Shared viewer saved/published flags and mutation state | **Working in current branch** | One fetch/cache per signed-in Workspace, one mutation path, no independent local flags; cross-tab and focus tests |
| C3. Typed project identities/read selectors | **Pending** | Common typed `ownerId/kind/projectId`, stable normalization for Library/Catalog/Saves, no project/media copies |
| C4. Loading/error/revalidation behavior | **Pending** | No F5, safe abort on navigation/viewer switch, no stale privilege leakage, no player disruption |
| C5. Cross-view acceptance and regression | **Pending** | Browser owner/non-owner/anonymous matrix; save/unpublish/rename/delete/cover/add-to on both views; pack order, null cover, queue/playing stable |
| C6. Phase C exit/release sign-off | **Pending** | User approves user-visible choices, tests green, manual matrix complete; ledger accurately updated; user authorizes merge/deploy |

**Do not claim Phase C complete because the shared card and menu exist.** C2–C5 still require implementation and live/manual verification. Phase B backend resolver consolidation, Phase D player extraction, Phase E cleanup stay separate. When adding work, mark exactly what is integrated vs branch-only vs tested vs still unverified.

## Product decisions to ask user during work (do not guess)

- **Saved item publication/access:** when someone unpublishes a project previously saved by another person, should it immediately disappear from that person's Saves unless they have an explicit share grant? Security default is **yes**; never retain private playback via stale client state. Check actual server semantics and discuss the UX.
- **Unsave in Saves tab:** should the card disappear immediately on successful Unsave (current behavior in own profile), or remain until navigation? Default to immediate disappearance unless user chooses otherwise.
- **Playback after metadata edits/deletions:** preserve audio uninterrupted for rename/cover; deletion must stop or remove the affected owned beat; details and cross-user revocation require review before D.
- Ask **one focused question at a time**, tied to a visible UI behavior; record the user answer in this document as an ADR/decision **before implementation**. Pending questions are not implementation approval.

## Work protocol and how another AI resumes

1. Read this file FIRST and `docs/architecture.md`; check GitHub PR/main SHAs and latest Actions, Vercel/Railway states. Never reconstruct progress from conversation memory.
2. Compare data shape in real `GET /api/public/mine`, `GET /api/library/files/items`, `GET /api/public/profile/:identifier`, authenticated mutations and API access tests. Inspect consumers (Library/Profile/Shared link) before editing.
3. Work only in the existing Phase C branch/PR when active, or a new isolated branch based on current main if completed. Update docs before changes, maintain one coherent batch per deployment. Never edit v1.
4. Run `npm test --prefix apps/api`, `node --experimental-strip-types --test apps/web/test/*.test.mjs`, `npm run build --prefix apps/web` via reviewed GitHub Actions; manually test user stories on approved environment. Preserve the player. State what is *not* covered by tests.
5. Only merge/deploy when user explicitly authorizes the batch. No extra Vercel deployments; previews disabled. Do not share credentials or production personal data.
6. Finish each PR with a precise report: head SHA, changes, tests and failures, missing E2E, migration impact, release status, outstanding product question and next Phase C task. Refresh this handoff and the progress ledger so the next AI can take over.

## Dated handoff log

- **2026-11-02:** User clarified that finishing Phase C **takes precedence** over Phase D/E. User demands one canonical shared component/service whenever technically appropriate, and wants an AI without chat memory to resume reliably from files. Started Phase C shared-data/handoff branch. No production or merge authorized for this new branch. Await decisions on save visibility/access and cross-view behavior.
