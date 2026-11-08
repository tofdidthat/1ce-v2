# 1CE v2

1CE v2 is an independent music-project platform. The monorepo contains a React + TypeScript frontend, a Node.js API, a PostgreSQL database model and private Cloudflare R2 storage.

**Documentation:** This README is the quick-start guide. All maintained technical decisions, module maps, operational instructions, release evidence and pending checks live in **[docs/architecture.md](docs/architecture.md)**. Historical documents and per-PR implementation notes remain recoverable in Git history, rather than maintained as separate Markdown files.

## Current verified baseline (2026-11-08 UTC)

- **Source:** [`tofdidthat/1ce-v2`](https://github.com/tofdidthat/1ce-v2) is **public**; production code baseline is [PR #70](https://github.com/tofdidthat/1ce-v2/pull/70), squash `c31c9a121aaf63aa35754954601f7022736f2746`. Older v1 `tofdidthat/1ce` is strictly read-only.
- **Deploy and tests:** [GitHub Actions main run 42433343084](https://github.com/tofdidthat/1ce-v2/actions/runs/42433343084) passed **all seven checks**; the same commit's Railway API deployment was **SUCCESS** and Vercel production was **READY**. The operator later reported that the deployed site worked normally. Treat that as a **manual report**, not proof of exhaustive two-account E2E.
- **Backend status:** PR #66 strengthened private pack-track owner/kind/READY checks and 404 behavior; PR #65 added read-contract and disposable PostgreSQL tests. PR #70 extracted four private metadata GET routes into `apps/api/src/library-read-metadata.ts` behind the unchanged `handleLibraryFiles` authorization/R2 gate. Audio/stems/cover streaming and all upload POST handlers were intentionally left in `apps/api/src/library-files.ts`.
- **CI / branch protection:** [PR #68](https://github.com/tofdidthat/1ce-v2/pull/68) restored GitHub Actions as the sole required CI provider. Active `1ce-main-protection` requires a PR, squash and seven passing checks: `dependency-audit`, `s2-local-s3-syntax-preflight`, `s2-postgres-migration-smoke`, `api-tests`, `railway-api-smoke`, `web-build (22)`, `web-build (26)`. No CircleCI checks are required; its automatic triggers were disabled **per operator report**. Retained `.circleci/` files are historical/rollback material.
- **Next:** Evaluate an independent, test-first refactor of private **streaming** GET routes (`audio`, `stems`, `cover`) only if requested; preserve 200/206/416, 404/503, cache headers, same-owner access, R2 behavior and playback continuity. Do not mix this with upload `init/complete`, SQL migrations, v1, Create Video or social distribution. See the current §0 and API-B sections of the [architecture guide](docs/architecture.md).



## Repository structure

| Directory | Responsibility |
| --- | --- |
| `apps/web/` | Vite/React frontend, UI components, styling and frontend tests |
| `apps/api/` | Node.js API, authentication, uploads, media, Trash and backend tests |
| `apps/api/src/library-read-metadata.ts` | Four owner-only library metadata GET handlers; called only through the private dispatcher |
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
