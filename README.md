# 1CE v2

1CE v2 is an independent music-project platform. The monorepo contains a React + TypeScript frontend, a Node.js API, a PostgreSQL database model and private Cloudflare R2 storage.

**Documentation:** This README is the quick-start guide. All maintained technical decisions, module maps, operational instructions, release evidence and pending checks live in **[docs/architecture.md](docs/architecture.md)**. Historical documents and per-PR implementation notes remain recoverable in Git history, rather than maintained as separate Markdown files.

## Current verified baseline (2026-11-08 UTC)

- **Source:** [`tofdidthat/1ce-v2`](https://github.com/tofdidthat/1ce-v2) is public. This checkpoint describes main `8b195df98ef062b01a9b6ea10abc9ecf9c8fa20c` (PR #83); the older v1 repository and all its production resources are strictly read-only.
- **Deployment:** Vercel production for `8b195df` was READY, and the login-used `1ce-v2-tofdidthat.vercel.app` alias was verified pointing to that deployment. Railway skipped this frontend-only change; its deployed API from PR #72 remains in service and `/health` returned OK. Recheck deployments and the alias after every release: this alias is manually assigned and does not automatically follow production.
- **Backend:** PR #70 extracted four private metadata GET handlers; PR #72 extracted private audio, stems and cover streaming into `apps/api/src/library-streaming.ts`. The facade keeps method/auth/R2 gates; upload POST and completion paths were not part of these extractions.
- **Frontend:** Home and Profile packs use the original inline Home detail and Back control; the global player remains mounted. PRs #73/#76/#78/#79 improved in-session loading and owner-scoped reuse. A full reload still needs session validation and new library/cover requests; persistent offline storage is not implemented.
- **CI:** GitHub Actions has seven required checks. CI success is not proof of authenticated two-account or live R2 end-to-end behavior; verify CI on each final commit.
- **Next:** Plan a separately reviewed offline experience for the user's own library, including storage limits, account isolation, authorization, synchronization, invalidation and logout. This is a proposal, not an implemented or approved architecture. See [docs/architecture.md](docs/architecture.md).

## Repository structure

| Directory | Responsibility |
| --- | --- |
| `apps/web/` | Vite/React frontend, UI components, styling and frontend tests |
| `apps/api/` | Node.js API, authentication, uploads, media, Trash and backend tests |
| `apps/api/src/library-read-metadata.ts`, `library-streaming.ts` | Private metadata and streaming GET handlers behind the authenticated facade |
| `history/database/` | v2 SQL migrations and guarded historical application scripts |
| `scripts/` | Dependency and repository audits |
| `.github/workflows/` | CI, API tests, disposable PostgreSQL smoke, frontend builds |
| `docs/architecture.md` | **Single technical guide and release reference** |

The original v1 repository, its live application, database, buckets and credentials are **read-only and outside the v2 deployment boundary**.

## Local development

Requirements: **Node.js 22+** and **pnpm 10.18.0** (pinned in root `package.json`). Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:web
```

In a second terminal:

```sh
pnpm --filter @1ce/api dev
```

Copy only the **variable names** from `apps/web/.env.example` and `apps/api/.env.example`; configure environment-specific secrets outside Git. `VITE_API_URL` must point to the intended **v2** API. Never reuse v1 production credentials.

## Validation

```sh
pnpm --filter @1ce/api test
node --experimental-strip-types --test apps/web/test/*.test.mjs
pnpm --filter @1ce/web typecheck
pnpm --filter @1ce/web build
node scripts/audit-dependencies.mjs
```

The GitHub Actions workflow tests API startup, ownership/pack contracts and migrations on **disposable PostgreSQL**, with the seven required checks above. A successful syntax-only R2 preflight is **not** a live R2 smoke test; external PostgreSQL/R2 tests must be isolated, explicitly authorized and never touch production media. Merges to `main` can trigger Vercel/Railway production deploys.

## Engineering rules

- Keep the v1 stack untouched; work on the v2 branch and environment only.
- Prefer existing components, CSS and TypeScript interfaces; avoid unnecessary files, duplication and unrelated refactors.
- Source in `apps/api/src/`, `apps/web/src/`, and `packages/shared/` is TypeScript-only, with `strict:true`, `allowJs:false`, and a recursive CI guard. Generated `dist/*.js`, tests and operator scripts are expected.
- Treat **implemented**, **merged**, **migrated**, **deployed** and **manually verified** as five different statuses.
- Do not reapply historical migrations or delete real user media because an older runbook says to.
- Review the relevant part of [the architecture and release guide](docs/architecture.md) before a change. Work in scoped batches, verify CI and get separate approval before production deploys or irreversible actions.
