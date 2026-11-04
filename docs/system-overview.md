# 1CE v2 — System overview

> **Scope:** code-level architecture inspected on `main` at `9f0bd2c89e49a3d332e11e805799c07710a47ace` (2026-11-04 UTC). This is not proof of the currently deployed runtime. See the [documentation index](README.md) for the dated release snapshot.

## Runtime and ownership

- **Web:** `apps/web/` — React 19, Vite 7 and TypeScript. `src/main.tsx` defines the application routes; the workspace, project cards, settings, upload, public profile, player-related views and their CSS are under `src/`.
- **API:** `apps/api/` — Node.js 22+ native HTTP server, with entry point `src/server.js`. Authentication and sessions use PostgreSQL; Google OAuth is handled by API routes. API handlers are organized by feature.
- **Database:** separate v2 PostgreSQL, not the v1 database. SQL source history is retained under `history/database/`; migrations are operator-controlled, not automatically applied during local development.
- **Object storage:** private Cloudflare R2. The database holds ownership and file metadata; project rows refer to file records instead of copying each beat, cover or stems object.
- **Environments:** Vercel hosts the v2 web frontend; Railway hosts the v2 API and PostgreSQL. Check actual deployment revisions independently before release claims.

## API feature map

| Feature | Module |
| --- | --- |
| HTTP router, sessions, login and Google OAuth | `apps/api/src/server.js` |
| Uploads, library files, media operations | `apps/api/src/library-files.js` |
| Projects, membership and project mutations | `apps/api/src/project-actions.js` |
| Trash, restore, permanent metadata purge and R2 delete outbox | `apps/api/src/trash.js` |
| Public profiles, publishing, saves and share links | `apps/api/src/public-profiles.js` |
| Authorized media resolution and playback | `apps/api/src/project-media.js`, `apps/api/src/audio-stream.js` |
| Profile identity, follows and links | `apps/api/src/profile-identity.js`, `profile-follows.js`, `profile-links.js` |
| Upload validation, leases, quotas, rate limits | `apps/api/src/upload-security.js`, `upload-leases.js`, `storage-plans.js`, `api-rate-limits.js` |

## Data and deletion invariants

1. A project belongs to one account. Every sensitive request must validate authorization on the server, not rely on UI state.
2. `library_files` records own the storage keys. Beats, covers, stems and packs may share file references; adding a project to a pack must not duplicate the physical object.
3. Trash moves project metadata to a soft-deleted state. Restore is owner-only within the specified 30-day window; publishing and sharing permissions are not automatically restored.
4. Empty Trash requires explicit confirmation. Only unreferenced, ready, owner-scoped verified media may be retired. Database reference constraints and a transactional R2-delete outbox protect shared objects.
5. Physical R2 deletes occur after the metadata transaction and may require retries. The current Trash workflow does not run automatic expiration deletion or a historical-orphan sweep.
6. The v1 application, database, sessions and storage are outside all v2 migrations and cleanup operations.

## Change protocol

1. Check the relevant API handler, web component and tests **before** touching behavior; reuse existing styles and utilities where possible.
2. Group related changes into a focused branch/PR. Record which code, migration and deployment boundaries the change touches.
3. For application changes, run API tests, web tests/typecheck/build and the repository CI checks.
4. For migrations, backups, authentication or permanent deletion, require isolated rehearsal, explicit environment checks, rollback planning and separate user authorization before any production action.
5. Distinguish **merged**, **deployed** and **verified in the browser**. Do not claim the latter from CI alone.

For detailed historical decisions and acceptance matrices, see [the architecture ledger](architecture.md). For Trash-specific release evidence and gaps, see [the Trash log](trash-v2-release.md).
