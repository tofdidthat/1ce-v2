# V2 cross-account playback adapter (incremental B/D boundary)

Status: implemented on feature branch and awaiting independent deployment validation. Original owner Library routes remain supported.

## Reproduced user-facing failure (2026-11-02)

Two independent signed-in browsers: account A publishes a beat or pack; account B opens A's public profile, saves the project; the original project shows in B's Saves with the correct cover but **no Play** and no bottom player. Source analysis identifies three causes:

1. Profile cards hid Play unless viewer === owner.
2. Profile sent only `(kind,projectId)` to the Library-owned player, which only searched B's own Library.
3. `/api/library/files/audio/:fileId` was an owner-only delivery path.

Saving a relationship is **not** a media permission grant. This changes no account/project IDs, underlying R2 objects, or save/publication relationships.

## Minimal justified HTTP contracts

The existing media-file policy is reused in `apps/api/src/project-media.js`. Two new routes are justified because there was no authorized cross-owner playback path:

- `GET /api/public/play/:ownerId/:kind/:projectId` — canonical project identity and authorized playback manifest. Returns `{project:{owner_id,kind,id,title,cover_file_id,tracks:[{owner_id,id,title,audio_file_id,cover_file_id,stems_file_id}]}}`. Beat: one original track; pack: ordered references to original beats; missing optional cover/stems remain `null`. No R2 keys. Stems references for other viewers are `null`.
- `GET /api/public/audio/:ownerId/:fileId` — original audio file, streaming from **private** v2 R2 with 200/206 byte-range support, 416 for invalid ranges, `Cache-Control: private, no-store` and `nosniff`. It uses `resolveAuthorizedMediaFile`, as existing audio/cover routes do.

Authorization: owner, published project (including anonymous), or explicit project share grant. A published/shared pack authorizes its original members' audio through the existing resolver. Saves alone never grant audio access; anonymous users never read private files. Missing/unauthorized references return a generic 404. Final stems **download** policy is unchanged: owner-only, no new download route.

No new database schema, file copy, public bucket policy, or redundant media state store.

## Frontend wiring

- Profile Catalog and Saves show Play for each visible project, including another account's projects.
- Play requests carry `ownerId + kind + projectId`; existing Library-owned audio player fetches the authorized manifest rather than searching the listener's own Library.
- Shared and owner beats use the same `/api/public/audio/...` delivery route and waveform cache indexed by owner + file.
- Existing player remains mounted while navigating `/app/library`, `/app/profile`, Settings, Upload and Discover.
- A public `/u/:username` page uses the same workspace/player so playback works when the viewer visits another user's profile, including anonymously published projects.
- Play/pause badge state is derived from the actual player, not an independent local per-card toggle.

**Remaining Phase D debt:** the audio controller is still physically owned by `LibraryItemsV2`; route transitions between the public `/u/:username` page and `/app/*` may remount it. Full top-level provider extraction and cross-route persistence are separate planned work.

## Tests and release checklist

- Mock authorization: owner, published, explicit share, private denied, saved alone denied, pack membership/order and optional assets.
- Mock private R2 byte-range delivery: 200, 206, 416, no object fetch for invalid range.
- Build + TypeScript and existing 19 tests in GitHub Actions.
- Deploy v2 API before frontend if manual; auto deploy should be inspected for both services.
- Repeat exact two-account user test: second account's Saves Play, bottom player, queue/pack order, navigation, seek, pause, waveform and correct cover.
- Verify third unauthorized browser cannot read A's unpublished audio/cover, even after constructing the audio URL; verify published and shared conditions.
- No Phase A completion claimed until real PostgreSQL + R2 and full permissions matrix have been validated and recorded.
