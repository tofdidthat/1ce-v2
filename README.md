# 1CE v2

1CE v2 is an independent music-project platform. The monorepo contains a React + TypeScript frontend, a Node.js API, a PostgreSQL database model and private Cloudflare R2 storage.

**Documentation:** This README is the quick-start guide. All maintained technical decisions, module maps, operational instructions, release evidence and pending checks live in **[docs/architecture.md](docs/architecture.md)**. Historical documents and per-PR implementation notes remain recoverable in Git history, rather than maintained as separate Markdown files.

## Repository structure

| Directory | Responsibility |
| --- | --- |
| `apps/web/` | Vite/React frontend, UI components, styling and frontend tests |
| `apps/api/` | Node.js API, authentication, uploads, media, Trash and backend tests |
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

The GitHub workflow also tests the API startup and SQL migrations on disposable infrastructure. External PostgreSQL/R2 tests must be explicitly isolated and authorized.

## Engineering rules

- Keep the v1 stack untouched; work on the v2 branch and environment only.
- Prefer existing components, CSS and TypeScript interfaces; avoid unnecessary files, duplication and unrelated refactors.
- Source in `apps/api/src/` and `apps/web/src/` is TypeScript-only, with `strict:true`, `allowJs:false`, and a recursive CI guard. Generated `dist/*.js`, tests and operator scripts are expected.
- Treat **implemented**, **merged**, **migrated**, **deployed** and **manually verified** as five different statuses.
- Do not reapply historical migrations or delete real user media because an older runbook says to.
- Review the relevant part of [the architecture and release guide](docs/architecture.md) before a change. Work in scoped batches, verify CI and get separate approval before production deploys or irreversible actions.
