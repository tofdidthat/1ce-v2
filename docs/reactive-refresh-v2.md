# Automatic refresh of 1CE v2 project state

Status: proposed on branch `fix/v2-reactive-data-refresh`; no production deployment, database migration, R2 mutation, or v1 change.

## Reproduced failure

A successful beat/pack upload navigates to `/app/library`, while `LibraryItemsV2` remains mounted to preserve the audio player. Its `GET /api/library/files/items` effect previously ran only on userId changes, so new projects did not appear until F5.

## Minimal refresh contract

- `apps/web/src/data-refresh-v2.ts` exposes scoped notifications (`library`, `saves`, `publications`, `shares`, `identity`) using one same-tab CustomEvent and an optional same-origin BroadcastChannel.
- Messages carry only scope and actor's numeric user ID, **not** project data, tokens or credentials. This is an invalidation signal, not an authorization mechanism or a persistent cache.
- The Library re-fetches item metadata after successful upload and on return to Library from other screens. It also re-fetches own publication/save flags on relevant changes.
- Profiles revalidate Catalog/Saves and viewer's saved/published flags after relevant mutations; share redemption/save emits notifications; editing account identity emits a notification for other tabs.
- While active, workspace screens revalidate when the window becomes visible/focused, without periodic polling; duplicate focus/visibility notifications are throttled.
- Every Library/Profile refresh uses AbortController and ignores stale result callbacks. No refresh resets `current`, `queue`, `playing` or the mounted audio element.
- The second browser/profile observes server-side changes by revalidating on focus. BroadcastChannel only connects tabs of the same origin/browser partition; it does not bypass auth and does not substitute server access checks.

## Verification

Run `npm test --prefix apps/api` and `npm run build --prefix apps/web`; GitHub Actions now also exercises scoped change notifications and return-to-focus behavior with Node 22.

Manual matrix before approving merge/release:

1. Upload a single beat, a two-beat pack, and a reused upload; each immediately appears in Library without F5.
2. Keep music playing while uploading or switching Library/Profile/Settings. Player/queue/waveform remain unaffected by metadata revalidation.
3. Save and unsave on Profile, switch to Library and back, and verify icon/list counts; repeat for publish/unpublish.
4. Open `/shared/:token`, redeem and save; visit Profile in the same and another browser tab and observe a refreshed Saves view.
5. Change username/avatar in Settings while another tab is open; the other tab updates after invalidation/focus.
6. Change project publication in another logged-in browser and return to the original window: Catalog and save visibility revalidate without F5.
7. Check a revoked/private project is never exposed by a stale local cache: API remains the sole source of authorization.

Never merge or deploy without user approval. Production builds on `main` remain a separate gate.
