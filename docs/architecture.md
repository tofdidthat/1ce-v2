# Protocol for complete change batches — read before changing 1CE v2

> **START HERE — SINGLE SOURCE OF TRUTH:** This document is both the permanent architecture guide AND the full Phase C AI handoff. Read the **"Phase C — zero-memory AI continuation guide"** section below for the current code/module map, implementation ledger, product decisions and exit checklist. **Complete Phase C before D/E.** Verify GitHub and deployments; no prior chat history should be required.

> **Mandatory working agreement (2026-11-02).** Whenever the user requests a complete feature, a refactor, several changes, or a production correction, **first read this entire `docs/architecture.md` and the relevant behavior/contract documentation** (notably `docs/refactor-phase-a-inventory.md`, `docs/shared-playback-v2.md`, `docs/reactive-refresh-v2.md`, and related migration/rollout notes). Compare the guide against the live code, the current branch, tests and deployment state; update this document when a decision or phase status changes **before implementing the feature**. Do not rely on historical chat descriptions or stale snapshots to declare work complete.

## Batch / deployment protocol

1. **Inventory and behavior:** identify user-visible acceptance criteria and affected UI, API, auth, SQL schema, R2, player, Saves/Catalog and permissions; inspect current existing methods before adding routes, tables or state. Document changes to behavior and architecture, including expected deletion and optional-asset behavior.
2. **Plan and isolation:** group related work into **one coherent batch**, in an isolated v2 branch, and prefer one reviewed PR and one production deploy per approved batch. Preserve v1 independence and original project/media IDs. Avoid redundant R2 copies and new database paths without justification.
3. **Implement and verify:** batch commits rather than deploying at every intermediate change; use GitHub Actions for API tests, frontend tests, TypeScript/build and regression checks. Test both ownership and cross-user access, missing optional cover/stems, navigation and persistent-player preservation. Be honest when live end-to-end testing cannot be done.
4. **Release gate:** review migration and runtime dependencies, confirm CI green, inspect diff and verify target branch/commit. **Do not merge or deploy unless the user authorizes this batch's publication**, or explicitly requests immediate release. On approval, deploy API/migrations in safe order then frontend, check Vercel READY/alias, Railway health and database, and report incomplete verification.
5. **Economize Vercel:** automatic previews for v2 are disabled to conserve Hobby deployment quota; **do not re-enable without permission**. Prefer CI-only validation on feature branches, no manual deployments for each commit and no duplicate retry loops. One deployment for a complete reviewed batch; handle build quota limits transparently.
6. **Documentation before code, then ledger:** maintain an accurate implemented vs validated vs pending phase ledger below, and update acceptance scenarios, docs/tests, or explicit decisions within the same PR. **Use this single `docs/architecture.md` as the handoff and progress record, not a separate phase-specific guide.** Before every future complete request, check this protocol **and behavioral contracts** again.

## Inline Edit Profile drawer / social links / publish picker (2026-11-03, branch only)

**User references:** Three supplied screenshots: a dark right-side edit profile sheet, a compact row of four Published project squares, and a searchable Post to profile project picker. Clicking the pencil on own public profile must open the sheet in the same Workspace, not navigate to Settings. Preserve mounted Library/player.

**Editor:** Photo at top (existing /auth/me/avatar), username below (existing PATCH /auth/me), social links third section (Spotify, YouTube, Instagram; other HTTPS links use the existing Link2 icon), and the published projects in the last section. Icon plus follows saved links and is the only icon when empty. Links are owner-entered URLs, NOT external OAuth connections. Saved links appear publicly below username. Persistent, v2-only v2_profile_links table with FK account ID, JSONB ordered links, and migration history/database/009_profile_links.sql. No new HTTP routes; extend the existing PATCH /auth/me and GET /api/public/profile/:identifier with validated public links. Validate HTTPS, no embedded credentials, max length/count, block local hosts and duplicate links, prevent unsafe href protocols. New schema auto-created by existing handlers if absent and separately documented in migration.

**Publish selector:** Published preview row displays four squares, empty slots plus, occupied slots thumbnails; it is a preview, NOT a four-project publication cap. Clicking square opens searchable Post to profile picker using the existing authenticated GET /api/library/files/items and normalizeLibraryProjectsV2, only own original beat/pack IDs. Selected indicators come from existing shared ProjectFlagsProviderV2; click toggles call existing togglePublished(kind,id) which uses the existing POST/DELETE /api/public/publish endpoint, without duplicate DB tables/routes or R2 copies. Keep picker open for multiple changes with Done. Revalidate Catalog and flags automatically, retain error/retry without F5.

**Scope/tests:** Branch feat/v2-inline-profile-editor based on main after PR #14. Responsive drawer, Escape/close, accessible controls, safe saving and error display, shared project covers. No changes to Follow, Saves permissions, player, Stems, Download or v1. API tests for ownership, valid/invalid link inputs, persistence, existing username/avatar contracts, and public read; frontend tests for new drawer, social icons, existing publish transport and viewer isolation. API/web/TypeScript/Vite CI required, real cross-account/mobile E2E remains unverified unless user tests own accounts. **No merge/deploy/migration on production without explicit approval.**

## Profile header visual alignment correction (2026-11-03, isolated branch)

**User-reported production regression after approved PR #13:** On own/public profiles, Back and the two upper-right profile buttons are out of alignment compared with the original 1CE workspace header; icons are white and the dedicated profile bar differs from the original low-contrast button style. Replace the new header positioning/styles with the **existing `HeaderV2` header's actual layout** (desktop 64px horizontal insets, 80px height, 18px top+safe-area, 6px action vertical translation; mobile 16px horizontal insets, 76px height, 16px top+safe-area, 4px translation). Reuse the existing `library-settings`, `onece-workspace-header`, `onece-workspace-brand` and `onece-workspace-actions` CSS and structure rather than another independent approximation. Back arrow is vertically aligned with right controls. Icons retain the canonical subdued `#aaa1b6` instead of bright white. Copy profile link must use Lucide `Link2`, the exact glyph in `ProjectContextMenuV2` for Copy link; do not use Lucide `Copy`. Keep Follow/Following, own Edit pencil, copy behavior, history navigation, permissions and player untouched.

**Implementation in draft correction branch:** `HeaderV2` now always supplies the original shared workspace styles while hiding its ordinary controls on profile routes; the profile header reuses `onece-workspace-header`, `onece-workspace-brand`, `onece-workspace-actions`, `library-settings` and actual 44px controls. Original desktop/mobile spacings and muted icon colors now come directly from the same CSS as every other workspace header. The Copy Link glyph is the exact `Link2` imported in the project context menu. Follow/Following, Edit, Back, Copy, project lists and player logic are retained. Added regression test `apps/web/test/profile-header-alignment-v2.test.mjs` to enforce geometry/colors/shared icon and updated follow header source contracts. **Manual visual acceptance is not claimed before release; do not merge or deploy without explicit user approval.**

**Work protocol:** Branch `fix/v2-profile-header-original-alignment` from currently merged `main` (PR #13 already integrated as `b695786806dc0b18c078e5045cef895846e89cab`, Vercel READY + Railway SUCCESS). Limit batch to profile layout and regression tests. Browser desktop/mobile visual acceptance is still pending user verification. GitHub Actions API/web/TS/Vite CI before review. Draft PR only, **no merge/deploy without explicit approval**, preserving Vercel quota. C5 cross-account verification and C6 sign-off remain pending.

## Profile header + persistent Follow batch (2026-11-02, merged PR #13)

**User-approved behavior / visual reference:** Inside either `/app/profile` (own account) or `/u/:usernameOrId` (other person's / own public URL), replace the normal top-right workspace avatar/nav icons with **Follow / Following and Copy Link** on other accounts, or **Edit (pencil) and Copy Link** on one's own account. Remove the tiny share icon alongside the displayed username. On the top-left render a Back arrow returning to the previous in-app route; direct links without a useful SPA back history fall back to `/app/library` for signed-in users or `/` for anonymous visitors. Copy Link puts a canonical `/u/:username` URL (numeric fallback) on the clipboard with feedback; it never creates an access grant. Own Edit opens the **existing functional Settings profile editor** (`/app/settings`), not the currently placeholder `/app/profile/edit` route. Profile-specific header replaces (not overlays without hiding) the existing workspace header. Keep the same mobile safe-area spacing and accessible labels.

**Follow is functional, permanent, and server-owned:** v2-only PostgreSQL table `v2_profile_follows(follower_id,followed_id,created_at)` with foreign keys to `account_users`, composite PK, self-follow CHECK, and reverse lookup index; `history/database/008_profile_follows.sql` records the idempotent schema. Follow/Unfollow is an authenticated, idempotent POST/DELETE on `/api/public/follows/:numericId`, server refuses self-follow and nonexistent target and enforces identity from the session cookie. Anonymous GET on this endpoint is allowed for public follower/following counts and the followed-account list, never for writing. GET also returns `viewer_follows` for a logged-in viewer (never for anonymous). Following tab lists the actual accounts the **viewed profile** follows and navigates to their public profiles; never display fake placeholders. No social notification or permissions grant. Authentication is required to follow; anonymous Follow redirects to the login route. Preserve existing project privacy, Saves/Publish permissions, R2, player and unrelated interactions.

**Implementation and verification (PR #13, merged and deployed as `b695786806dc0b18c078e5045cef895846e89cab`):** Profile navbar implemented for own and public profiles; own Edit opens `/app/settings?edit=profile`, which activates the existing functional Settings editor. Follow/Unfollow uses the session-authorized `profile-follows.js` service with DB PK, cascade, self-follow guard and indexed counts; the public Following tab reads actual followed accounts. `profile-follows-v2.ts` handles fetch/mutations, `data-refresh-v2.ts` adds a scoped invalidation signal. Existing Catalog/Saves and player controllers remain unchanged; cover session cache remains in this same branch. Backend lazily initializes *only the isolated v2 table* if missing; `history/database/008_profile_follows.sql` provides the idempotent schema for audit/pre-apply. **GitHub Actions #78 SUCCESS** for API mock tests, frontend regressions and TypeScript/Vite on code commit `6d179e60`; any later doc-only commit requires final CI verification. The v2 follow table was initialized on the production API and public GET `/api/public/follows/1` returned HTTP 200; no actual follow relationships were created by automated tests. The C5 owner/saver/third-party and real Follow visual matrix remains unverified by real accounts (user disallowed test accounts); navigating between route roots may still remount the existing player until Phase D. PR #11's anonymous profile message fix overlaps the profile change included in PR #13; reconcile them before any later merge. The user approved publishing PR #13; it was merged and Vercel/Railway deployed the same SHA. The immediate profile visual correction lives in the separate draft PR documented above; **do not deploy it without a new explicit approval.**

## Cover persistence / session cache batch (2026-11-02, merged PR #13)

**Reported behavior:** unchanged project covers visibly disappear/reload when navigating between Library, Catalog and Saves or when cards remount. Verified source cause: `ProjectCoverV2` fetches the same authorized `/api/public/cover/:ownerId/:fileId` and revokes its Blob URL on *every component unmount*; the dock player duplicates that fetch. The backend intentionally sends `Cache-Control: private, no-store` for authorization-dependent covers. **Do not weaken server privacy headers or persist private media in localStorage/IndexedDB/Service Worker.**

**Shipped scope from batch `perf/v2-cover-session-cache`:** one shared, per-Workspace/per-viewer **in-memory** cover cache for Library, Catalog, Saves, opened beat/pack and the existing player cover; key is canonical original `ownerId:fileId`, and the cache instance is partitioned by authenticated viewer (or anonymous). Deduplicate concurrent downloads, reuse object URLs across view remounts, cap memory with LRU eviction of *unused* URLs, expire unused entries after a short TTL, abort outstanding requests and revoke all Blob URLs when the Workspace unmounts/viewer changes. Never reuse the old viewer's URL while the new viewer is loading. Cover change naturally produces a new file ID; missing/unauthorized/invalid image responses must not be cached. Cache affects *displayed image bytes only*, not project identity, saves, permissions, published state or the authoritative list fetches. Existing cross-tab/focus metadata refresh remains enabled; cache must not prevent metadata revalidation. Do not change playback state/audio transport, API, database, R2, v1, Download or Stems.

**Limitations/security:** session-memory reuse does not survive F5/full reload; every new request is still authorized server-side. Previously viewed image pixels may remain in a live tab while the image is mounted; there is no permanent client storage. On change of account, clear all cached image bytes/URLs. On metadata cover-file-ID changes, render the new image rather than a stale one. This is a performance/UX improvement, not proof of real-world cross-user revocation timing.

**Automated verification performed; real-device visual verification still pending:** tests for one download shared by multiple cards/player, remount reuse, owner/file separation, viewer cache isolation, changed file ID, invalid image/error retry, LRU/TTL cleanup, pending-request abort on dispose, no stale URL across viewer switch; web typecheck/Vite build and API regression tests. Manual browser verification still needed for actual mobile cover flicker, cross-account access and player continuity. **Do not merge/deploy without user approval.** C5 and C6 remain pending; separate draft PR #11 for anonymous profile UX is not included in this branch.

## Parallel work lanes — Main Plan and Mobile Fixes (2026-11-02)

- **Main Plan:** Phase C3+C4 typed project reads, refresh/loading/error consistency, then C5 real-account acceptance and C6 sign-off. This remains the primary architectural roadmap. Mobile work must not silently replace or mark it complete.
- **Mobile Fixes:** small, independent, user-reported mobile usability bugs in dedicated branches/PRs, grouped sensibly to minimize Vercel deploys. Keep scope limited to mobile behavior, retain desktop behavior, and avoid changing player, backend, storage, permissions, or Main Plan data refactors. Do not merge or deploy without explicit authorization.
- **Mobile correction #9 complete:** `fix/v2-mobile-compact-navbar-tap` merged to `main` at `5652413dd80c71134b8a0c194b459910286833dc`; user confirmed on their actual mobile device that the rightmost Home / Discover / Upload / Settings dropdown now opens and works. No additional Mobile Fixes batch is active.
- **Mobile #9 verification:** user verified opening and navigation on phone; automated tests/build passed. Desktop hover, keyboard, outside tap and Escape were source-tested but not reported as manually E2E tested. Continue to track any later regressions separately.

**Shared project actions — mandatory single-component contract:** The right-click/ellipsis project context menu is ONE shared React component used by Library and Profile (owner Catalog and Saves), with identical owner actions, labels, disabled states, confirmation dialogs and API semantics. Neither screen may maintain a separate copied menu implementation or placeholder action buttons. Only view-specific callbacks (publish/save/share/queue) may be supplied as props; all permanent project mutations use the same `ProjectActionDialogV2` and server routes. Any future menu change MUST be tested in Library and Profile, including cross-account read-only permissions, without introducing a duplicate menu. A fix that works only in Library is incomplete.

**Shared-component first rule:** When Library, Catalog, Saves, Shared links, a player view or another screen displays the SAME project responsibility, reuse ONE canonical component/service with explicit visual variants and callbacks. This applies to project cards, covers, play controls, context actions, dialogs, authenticated mutation helpers and later data/state controllers. Pages may compose these differently, but must not copy media fetching, business rules or permission logic. Before implementing a feature, search ALL consumers and add cross-view regression coverage. Do not force unrelated responsibilities into a single oversized component.

**PR #5 Phase C consolidation (merged; dated 2026-11-02):** First document and implement the lower-risk shared UI foundations: one `ProjectCoverV2` (canonical authorized `/api/public/cover/:ownerId/:fileId`, optional-cover fallback, cancellation and object-URL cleanup), one `ProjectCardV2` (Library/owned Catalog/Saves presentation variants, shared play affordance and context-event contract) and a small shared typed API helper for save/publish/share mutation calls. Preserve visual variants and existing player callbacks. These steps are NOT a claim that all Phase C/D/E work is complete; global player ownership, centralized query/cache state, legacy media route removal, and other consumers remain later work. Validate the three views, owner/non-owner permissions, missing covers, pack order, playback and refreshing in one CI batch before merging.

**Binding boundaries:** do not change/download stems or unrelated features without request; never change v1 or its database/bucket. Published, explicitly shared and personally saved permissions remain server-authoritative; a valid Save creates personal audio/cover access for that saver (even after Unpublish), never stems access or third-party visibility. Preserve a single active player and original project identities. No destructive action without explicit user confirmation in the interface and safe server checks.


## Phase C — zero-memory AI continuation guide (single source of truth)

> **Priority and scope:** Complete Phase C (shared UI and project-data architecture) before the Phase D global-player extraction or Phase E cleanup. This section replaces the temporary handoff file; **do not create a separate Phase C handoff Markdown**. An AI inheriting this project must be able to resume using this one guide plus the repository without prior conversations, saved memory or credentials. Dates below are snapshots, not claims about the current deployment.

### Current status and verification snapshot

1. **Repository:** `tofdidthat/1ce-v2`; production deploy branch `main`. Frontend: React/TypeScript/Vite in `apps/web` (Vercel project `1ce-v2`). Backend: Node in `apps/api` (Railway service `1ce-v2`), its own PostgreSQL, private v2 Cloudflare R2. **Never touch v1** (`1ce`, `1ce-server`, v1 DB/bucket).
2. **Last confirmed integrated:** PRs #1–#7, Mobile Fixes PR #9, Main Plan PR #10 and profile/cover PR #13 merged to `main`. PR #13 deployed as `b695786806dc0b18c078e5045cef895846e89cab` (Vercel READY, Railway SUCCESS, public Follow API 200). PR #9 squash SHA `5652413dd80c71134b8a0c194b459910286833dc` (mobile dropdown user verified); PR #10 squash SHA `69f3559fd9f00fbab7f765e8b97477d745195d34` (C3+C4). Vercel production READY and Railway SUCCESS on #10. **C5 only partially tested anonymously; no test accounts by user request.** PR #11 remains separate/draft. Recheck live GitHub/Vercel/Railway status before runtime claims.
3. **Main Plan PR #10 integrated:** [refactor(v2): C3+C4](https://github.com/tofdidthat/1ce-v2/pull/10) merged and deployed as `69f3559fd9f00fbab7f765e8b97477d745195d34`. Canonical typed read adapters and robust async loading/error/retry are on production; CI #56 passed before merge. **C5 multi-account acceptance and C6 sign-off remain open.** This cover cache is separate draft PR #13, not part of production.
4. **Implemented and merged in PR #7 (`main`):** `apps/web/src/project-flags-v2.tsx` adds a single `ProjectFlagsProviderV2` above mounted Library/Profile, fetching `GET /api/public/mine` once per refresh and providing shared saved/published state, scope/focus revalidation and mutation callbacks. `apps/web/src/project-identity-v2.ts` holds typed identity and pure normalization; `project-requests-v2.ts` now uses the canonical kind. Library and Profile no longer independently fetch `/api/public/mine` or keep flag Sets. `apps/web/test/project-data-v2.test.mjs` and the shared-component contract tests cover the normalization/isolation and same-provider wiring. This is **C2 merged and CI-validated, not manually E2E validated**. Profile and Library still fetch separate view metadata intentionally; the player is still Library-owned.
 `library-items-v2.tsx` and `public-profile-v2.tsx` consume shared flags from `ProjectFlagsProviderV2`; do not reintroduce per-view `/api/public/mine` fetches or flag Sets. `ProjectCardV2`, `ProjectCoverV2`, `ProjectContextMenuV2`, `ProjectActionDialogV2` and `project-requests-v2.ts` already exist. `data-refresh-v2.ts` delivers **invalidation only**, not canonical state. `WorkspaceV2` in `workspace-v1.tsx` mounts Library invisibly to preserve the player. Do NOT move/unmount that player during Phase C.
5. **Check status before declaring complete:** CI green at exact PR head; run manual browser tests owner / different logged-in user / anonymous; validate public/private cover/audio through authorized routes; Vercel and Railway health only if a release is approved. An automated source-code regex test is NOT a visual or real-DB E2E test.

### Component and service ownership

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

### Frontend data contract (Phase C target)

- One **viewer-scoped** project flags store or context, above Library and Profile, keyed to the authenticated viewer ID. It fetches `GET /api/public/mine` **once per refresh**, holds saved keys `ownerId:kind:projectId` and own publication keys `kind:projectId`, and exposes `isSaved`, `isPublished` and shared mutation methods.
- On a successful Save/Unsave or Publish/Unpublish: update the viewer store once, emit the appropriate scoped `notifyV2DataChanged`, then revalidate from the server. On error keep the previous state and display feedback. Cross-tab/focus signals trigger server refetch; no polling. Abort/ignore stale requests on viewer changes or unmount. Never share flags across accounts.
- Profile Catalog/Saves lists and Library items are **different server resources**; they may keep view-specific metadata while consuming the *same* flag state. Do not conflate a project appearing in Catalog with being saved. All list changes must revalidate via existing scopes. Optimistic removal from a list is a presentation detail only.
- Do **not** introduce a parallel React Query/Zustand store or global persistence solely for this increment. Avoid exposing R2 keys or credentials. If a shared query cache is introduced later, document invalidation, TTL, ownership, permission revocation, and which view owns the request.
- `ProjectCoverV2` owns image fetch/abort/blob revocation; `ProjectCardV2` owns card play affordance; the view supplies the playback callback and on-context-menu callback. The player itself remains mounted in Library temporarily.

### Main Plan implemented batch — Phase C3+C4 (merged; C5 still open)

**Objective:** finish the reusable typed project *read* contract and consistent asynchronous UI behavior for Library, Catalog and Saves, without moving the player. This is the next single-branch, single-PR batch. This plan is **not authorization to merge or deploy**.

1. **Read-model audit first:** inspect `library-items-v2.tsx`, `public-profile-v2.tsx`, `project-flags-v2.tsx`, `project-identity-v2.ts`, `data-refresh-v2.ts`, `project-requests-v2.ts`, and the existing API response shapes. Record which list fields differ and which must stay view-specific. No new endpoints or tables merely to normalize the UI.
2. **C3 — shared pure models/selectors:** define canonical typed `ProjectRef` (`ownerId, kind, projectId`) and normalized display/read fields; write small pure adapters for Library items and Profile Catalog/Saves rows. Provide stable identity, safe null cover/stems handling, pack membership/track ordering, and per-view projections. Keep server access checks authoritative; no client-side permission inference. Do **not** build a second saved/published store, React Query cache, or a mega component.
3. **C4 — consistent fetch state:** consolidate reusable request/error/abort primitives only where they actually duplicate. Expose explicit loading, empty, error and retry states, especially `ProjectFlagsProviderV2`; avoid showing false Save/Publish actions before viewer flags load or after failed fetch. Abort/ignore stale responses on account switch, navigation and repeated focus/cross-tab invalidation. Preserve the existing scoped refresh events and prevent F5 requirements. Keep view-specific metadata requests separate if their resources differ.
4. **Mutations/refresh contract:** Save/Unsave, Publish/Unpublish, Rename, Change cover, Add to, Delete revalidate the right scopes; successful Unsave removes a Saves card without navigation, failures preserve it and surface feedback. Maintain original IDs, private Save visibility, durable saver audio access after Unpublish, and no media copies.
5. **Automated acceptance:** unit tests for adapters/selectors, optional fields, owner/saver/third-party identities, stale request races, error/retry, cross-view flag consistency, and refresh. Run API tests, web tests and `npm run build --prefix apps/web`. No changes to player controller, Download, Stems, v1, R2 or database migrations.
6. **Manual acceptance before Phase C sign-off:** in a real browser with owner, saver and third account plus anonymous, exercise Library/Catalog/Saves, share link redeem, Save/Unsave, Publish/Unpublish, audio/cover privacy, pack order, null cover, account switching, focus/cross-tab, action menus, and playback continuity. Record observed results vs untested cases. Browser E2E is a release gate, not automatically proven by source tests.

**Boundaries:** C5 real-environment acceptance and C6 Phase C exit/sign-off remain open after the code batch unless independently verified. Phase D player extraction and Phase B/E media cleanup are expressly excluded. **Revocation of share links is deferred**; current v2 has no revoke endpoint, and the user has not decided how future revocation should interact with existing personal Saves.

**2026-11-02 implemented and subsequently merged/deployed in PR #10:** `refactor/v2-phase-c3-c4-project-reads` from `main` after merged/mobile-verified PR #9. Added `apps/web/src/project-read-v2.ts` as a shared, pure typed adapter for Library beats/packs, Profile Catalog/Saves and pack tracks in server-defined order. Library and Profile consume canonical read fields; cover/stems remain nullable, project identity is original, no media copies. `project-flags-v2.tsx` now exposes viewer-scoped loading/ready/error and retry, and rejects mutations before flags are verified; shared context menu disables Save/Publish in unverified states. Library Retry re-fetches without F5; pack-detail requests cancel on switch/back; Library clears open private metadata panels when the viewer changes; Profile responses are scoped to viewer+target, with error/Retry and abort. `apps/web/test/project-read-v2.test.mjs` validates adapters and source contracts. **CI #56 SUCCESS** on final code SHA `86303953` (API + web + TS/Vite); squash merge `69f3559fd9f00fbab7f765e8b97477d745195d34` deployed. Browser/E2E matrix C5 and final release C6 remain pending. No change to persistent player controller, Download, Stems, v1, API/R2/DB.

### Phase C ordered checklist and exit gates

Status legend: **done/merged**, **working**, **pending**, **blocked by product decision**.

| Item | Status at handoff | Definition of done |
| --- | --- | --- |
| C1. Reusable menu/card/cover/dialog/HTTP helpers | **Done/merged (#4–#6)** | Same actions/visuals in Library and Profile; correct ownership |
| C2. Shared viewer saved/published flags and mutation state | **Merged (#7), CI green; manual multi-account verification pending** | One fetch/cache per signed-in Workspace, one mutation path, no independent local flags; cross-tab and focus tests |
| C3. Typed project identities/read selectors | **Merged/deployed (#10), CI green; manual verification pending** | Common typed `ownerId/kind/projectId`, stable normalization for Library/Catalog/Saves, no project/media copies |
| C4. Loading/error/revalidation behavior | **Merged/deployed (#10), CI green; manual verification pending** | No F5, safe abort on navigation/viewer switch, no stale privilege leakage, no player disruption |
| C5. Cross-view acceptance and regression | **Partially verified anonymously; authenticated matrix pending (no test accounts by user request)** | Browser owner/non-owner/anonymous matrix; save/unpublish/rename/delete/cover/add-to on both views; pack order, null cover, queue/playing stable |
| C6. Phase C exit/release sign-off | **Pending** | User approves user-visible choices, tests green, manual matrix complete; ledger accurately updated; user authorizes merge/deploy |

**Do not claim Phase C complete because the shared card and menu exist.** C2–C5 still require implementation and live/manual verification. Phase B backend resolver consolidation, Phase D player extraction, Phase E cleanup stay separate. When adding work, mark exactly what is integrated vs branch-only vs tested vs still unverified.

### Product decisions (confirmed vs pending)

- **CONFIRMED 2026-11-02 — Unpublish, private Saves and links:** Unpublish removes a beat/pack from public Catalog/discovery, **not from the saved-project relationship**. The saver must still see their own saved item in Saves (assuming the project still exists), while **other visitors must not see any unpublished project in that saver’s public Saves view**, even if those visitors separately have share grants or are the project owner. Publicly published saved items may remain visible in profiles according to public Saves behavior. A user redeeming the owner's share link receives an explicit project access grant and may save the original private project; its saved entry is **visible only to the saver** while unpublished. A person who saved a public project while authorized keeps **personal audio and cover playback after Unpublish**. The Save relationship is a durable, per-saver server-side access entitlement, not publication, a media copy or a stems grant. Another user visiting that saver's Saves cannot see the private entry or use the saver's entitlement to play it. Unsave removes the personal entitlement unless another independent authorization remains. Deleting the underlying project removes related saves and access. Implement and test visibility AND media endpoints on the server, never via CSS/client filtering.
- **CONFIRMED 2026-11-02 — Unsave in Saves tab:** when the user clicks **Unsave**, the corresponding card must disappear **immediately after the server confirms success**, without F5 or switching tabs. On request failure, it stays visible and the error is surfaced. Apply consistently to own Saves and shared components. The decision is final unless the user explicitly changes it.
- **Playback after metadata edits/deletions:** preserve audio uninterrupted for rename/cover; deletion must stop or remove the affected owned beat; details and cross-user revocation require review before D.
- Ask **one focused question at a time**, tied to a visible UI behavior; record the user answer **in this architecture guide**, with date and implementation/testing status, before implementation. Pending questions are not implementation approval.

### How to resume independently, without chat history

1. **Verify actual GitHub state:** repository `tofdidthat/1ce-v2`, current `main` and open PR heads, checks, deployments. Do not assume historical branch/PR status remains true. Follow the batch/release protocol at the start of this guide.
2. **Inspect source and backend shapes:** `GET /api/public/mine`, `/api/library/files/items`, `GET /api/public/profile/:identifier`, Save/Publish/Share mutations, media and ownership checks, and all UI consumers before adding state/routes.
3. **Implement one shared responsibility:** reuse existing `ProjectCardV2`, `ProjectCoverV2`, `ProjectContextMenuV2`, `ProjectActionDialogV2`, and `ProjectFlagsProviderV2` (merged in PR #7); keep list/presentation concerns inside appropriate views. Do not clone projects or introduce parallel caches.
4. **Check regression gates:** GitHub Actions runs `npm test --prefix apps/api`, `node --experimental-strip-types --test apps/web/test/*.test.mjs`, and `npm run build --prefix apps/web`. CI source-contract tests alone are not visual or database E2E tests. Manual matrix must cover owner/non-owner/anonymous, Library/Catalog/Saves, null cover/stems, Save/Unsave, Publish/Unpublish, Add to, Rename, Delete, focus/cross-tab, and playback continuity.
5. **Update this guide within the same PR:** exact branch/PR/SHA, what is on `main` vs branch-only, validations run, missing real-environment verification, open user choices, next Phase C item and release status. **No new handoff file, no merge or deploy without the user's authorization.** Vercel previews are intentionally disabled to conserve the Hobby deployment quota.

### Accepted private-save behavior (server/UI acceptance matrix)

| Case | Saved reference remains? | Visible in saver’s own Saves? | Visible to a third-party visiting saver’s profile? | Media access |
| --- | --- | --- | --- | --- |
| Published beat saved by an authorized person | Yes | Yes | Yes while published | Published project rules |
| Owner clicks Unpublish after someone saved | **Yes** | **Yes** | **No** | Saver may still stream the original audio and cover with own authenticated Save; no anonymous/third-party playback |
| Recipient redeems valid private sharing link, then saves | Yes | Yes | **No**, including viewers with other grants | Recipient's grant and own Save permit audio/cover, never stems by default |
| Saver clicks Unsave | **No** after successful server response | Disappears immediately | No | Saver loses Save-based access; any independent share grant/publication remains valid |
| Project physically deleted | No, relationship deleted | No | No | Server must revoke project access; original R2 cleanup remains a separate policy |

**Implementation notes:** currently `apps/api/src/public-profiles.js` filters the saved entries returned by `GET /api/public/profile/:identifier` using publication and viewer grants. The API must enforce **viewer is saver OR project is published**, never disclose the saved private entry simply because viewer is owner of the underlying project or a separately granted recipient. Tests must cover saver, third-party (including another grantee), and Unpublish not deleting saves. A Save created by an authorized viewer retains that viewer's audio/cover access while the Save remains, even if publication later ends. It is neither a public listing nor another viewer's access. Access enforcement remains server-side; never use local flags to bypass authentication.

### Phase C3+C4 integrated acceptance record (PR #10)

- **Implemented/CI-tested:** canonical typed metadata normalization and original owner/kind/project IDs; ordered pack member tracks; safe optional cover/stems; a single saved/published flags provider that distinguishes `loading`, `ready`, `error`; error display/retry without F5; server-confirmed Save/Unsave behavior retained; discard stale profile and pack-detail responses on viewer/target switches.
- **Not yet confirmed in browser:** full owner/saver/third-party/anonymous matrix, focus/cross-tab refresh timing, all menus and personal playback after Unpublish, player continuity when navigating or renaming/deleting. Automated tests and TypeScript build are necessary but do not constitute live PostgreSQL/R2 E2E testing.
- **Release:** PR #10 merged with user approval; Vercel and Railway deployed the exact squash commit. Anonymous C5 smoke checks passed for health/database/public metadata/manifest/cover, but multi-account and real player scenarios remain unverified. PR #11 and cover cache PR #13 remain draft and unmerged.

### Dated Phase C implementation handoff log

- **2026-11-02:** User made Phase C the priority ahead of D/E and requires single components/services wherever responsibilities match.
- **2026-11-02 — historical draft PR #7, subsequently merged:** [PR #7](https://github.com/tofdidthat/1ce-v2/pull/7) on `refactor/v2-phase-c-data-and-handoff`. Code branch only: one viewer-scoped `ProjectFlagsProviderV2`, removal of per-view `/api/public/mine` fetches/flag Sets, typed `project-identity-v2.ts`, normalization + regression tests. Code commit `bbaeb6fa` passed API, web tests and TypeScript/Vite build. An earlier CI run failed due to obsolete imports; these were fixed. **This describes an earlier pre-merge snapshot, not current status.** Manual multiuser/focus/account-switch/playback testing still missing.
- **2026-11-02 — product decision:** User confirmed Unsave removes the project card from their Saves immediately on successful server response. User also required this **single `docs/architecture.md`** as the authoritative guide; the temporary `docs/phase-c-handoff.md` must not be retained in the PR.

---

# 1CE v2 — Architecture and Refactoring Plan

> Status: living architecture document. Read section 0 for the latest implementation and verification ledger. Sections 5–7 are target behavior and remaining migration gates; implemented milestones are separately recorded in section 0.

> **2026-11-02 resolved:** PR #4 initially left Profile's menu disabled. PR #5 connected the Profile and Library to the same menu/action-dialog; PR #6 fixed Add-to chevron alignment. CI passed, but full browser E2E/multi-account acceptance remains pending. The next priority is unified project flag/data state, not player extraction.

## 0. Progress ledger — current phase and completed work (2026-11-02)

The refactor is **in progress, spanning phases A–D**. **We are currently prioritizing C (shared frontend behavior and project actions), while B and D still have consolidation debt.** Phase E has not been completed. These statuses distinguish code integrated on `main`, automated tests, deployment, and end-to-end verification:

| Phase | Implemented and merged in v2 | Still missing before exit |
| --- | --- | --- |
| **A — Inventory and tests** | Inventory and risk/contract matrix recorded; API fixture-based tests (28 passed on latest verified CI); second-account sharing/Saves behavior manually exercised; profile/avatar and playback bug reproduction; cross-tab refresh tests (3 passed). | Full systematic owner/public/shared/anonymous live DB + R2 regression matrix; explicitly approve final stems policy; complete contract/behavior inventory and sign off A exit. |
| **B — Canonical project resolver/media policy** | `project-media.js` shared authorization behind existing private/public routes; `/api/public/play/:owner/:kind/:id` project manifests and `/api/public/audio/:owner/:fileId` authorized streaming with byte ranges; original files and pack order preserved. Deployed and public beat/pack manifests smoke-tested. | Consolidate duplicate cover routes, typed canonical manifest for all consumers, verify private/shared access and deletion/revocation against live isolated v2 PostgreSQL and private R2. Stems remain interim owner-only. |
| **C — Shared frontend project/media layer** | Settings username/avatar merged and deployed with migration 007; public profile Catalog/Saves; cross-owner Play controls; project/save/publish flags and cross-tab/focus refresh; upload Library refresh merged and Vercel READY; PR #4 delivered owner actions in Library. | Shared menu/card/cover/action-dialog/HTTP helpers merged via PR #5; Add-to alignment via #6. **Next: unified viewer-scoped saved/published state, typed project selectors, consistent cross-view invalidation, cross-account/manual acceptance. This is the active Phase C work.** |
| **D — Persistent player / shared projects** | Library-owned audio player kept mounted across `/app/*` view transitions; cross-user and `/u/:username` playback through shared manifests, correct ordered pack references and R2 ranges; CI passed. | Extract controller above route/view lifetime; verify transitions between `/u/*` and `/app/*`, queue behavior after project edits/deletion, full multi-account manual playback scenarios. |
| **E — Consolidation and release** | Partial cleanup/test documentation, merge gates and one-deploy-per-batch process; Vercel previews disabled and CI used independently. | Full route/state/cover consolidation, error/caching/memory review, staging and production end-to-end acceptance matrix and written Phase E sign-off. |

**Integrated batches verified from Git:** PR #1 Settings identity; #2 secure cross-owner playback; #3 reactive refresh; #4 owner project actions (main `8344d939`); #5 shared menu/card/cover/http helpers (`176e4480`); #6 Add-to chevron fix (`8663903a`; CI succeeded; Vercel READY at time of observation, Railway deployment still building). Phase C work after #6 is on branch `refactor/v2-phase-c-data-and-handoff` and is **not** merged. Always recheck deployment status and PR heads. Publication of a new batch requires explicit user authorization.

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
- `apps/web/src/public-profile-v2.tsx` loads Catalog/Saves. PR #5 **merged** `ProjectCardV2`, `ProjectCoverV2` and `ProjectContextMenuV2` reused in Library and Profile; common media path `/api/public/cover/:ownerId/:fileId` and common HTTP mutation helpers. Remaining debt: independent saved/published sets and `GET /api/public/mine` in each view, plus the Library-owned player.
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

**Access rules (target, including durable personal Saves):**

| Actor | Private project | Published project | Explicitly shared project |
| --- | --- | --- | --- |
| Owner | Full project and permitted assets | Full project and permitted assets | Full project and permitted assets |
| Authenticated non-owner | No access by default; **own previously authorized Save grants personal audio/cover access** | Allowed according to public project policy | Allowed for explicitly granted project |
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
- **Saves:** references to original projects, including the user's own projects. Saving/un-saving does not create media copies. A successful authorized Save creates a **private, persistent audio/cover access relationship** for that saver, even if the owner subsequently unpublishes. The saver sees their saved entries while they exist. **Unpublished saves are invisible in other people's views of the saver's profile, even to visitors with their own independent share grant.** Only published saved items may appear publicly. Media endpoints must check that the requester is the original saver; stems remain owner-only.
- **Sharing:** redeeming a valid share link grants authenticated access to the original beat/pack and allows the recipient to save it, even when unpublished. The share grant and saved relationship are independent personal authorizations; both persist through Unpublish, neither reveals private Saves to strangers, and neither duplicates media. On Unsave, only the save-based entitlement disappears. Precise future revocation policy for saved access after a separately revoked share grant remains a product decision.

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

- **2026-11-02 — confirmed privacy semantics, merged PR #7:** Unpublish removes Catalog publication only; saved entries persist privately. A user who saved a public beat/pack keeps **personal audio/cover access** after Unpublish, without a new share link. A third user cannot see that private item in another's Saves or play it through that Save. `apps/api/src/public-profiles.js` enforces per-saver visibility; `apps/api/src/project-media.js` now checks saved project relations for authorized personal playback and media reads. Tests cover owner, saver, third-party, pack members, cover, stems and share redemption. **Merged to main**; CI passed, deployment readiness and manual E2E still require verification. Future explicit share-grant revocation vs independent Save entitlement is not yet defined.
