# 1CE v2

Independent 1CE application built with a React/Vite frontend, a Node.js API, PostgreSQL and private Cloudflare R2 storage. The v1 application and its infrastructure are separate and must remain untouched.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | React, TypeScript and Vite frontend; UI modules, styles and frontend tests |
| `apps/api/` | Node.js HTTP API; authentication, projects, media, Trash and API tests |
| `history/database/` | Versioned v2 SQL migrations and guarded historical apply scripts |
| `docs/` | Architecture overview, navigation, dated implementation ledgers and release evidence |
| `scripts/` | Repository-wide audit tools |
| `.github/workflows/` | CI checks and disposable-database smoke tests |

## Local development

Use **Node.js 22 or newer** and **pnpm 10.18.0**, as pinned in the root `package.json`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:web
```

Start the API separately:

```sh
pnpm --filter @1ce/api dev
```

Frontend configuration is illustrated in `apps/web/.env.example`; API configuration examples are in `apps/api/.env.example`. Provide required values through local environment variables, keep local secrets out of Git, and never reuse v1 production credentials. The frontend's `VITE_API_URL` must point at the intended **v2** API.

## Validation before changes

```sh
pnpm --filter @1ce/api test
node --experimental-strip-types --test apps/web/test/*.test.mjs
pnpm --filter @1ce/web typecheck
pnpm --filter @1ce/web build
node scripts/audit-dependencies.mjs
```

GitHub Actions also runs API tests, a disposable PostgreSQL migration smoke test, an API startup check and frontend builds. Tests that exercise external infrastructure must be deliberately authorized and isolated.

## Safety and release rules

- Keep v1 code, data, sessions, buckets, tokens and domains unchanged.
- Treat all SQL migrations as environment-specific operations; **do not rerun archived migrations** merely because they exist in Git.
- Changes that can delete R2 data need backup evidence, independent review, disposable-media testing and a separately approved rollout.
- A successful merge or CI run does **not** by itself confirm a Railway/Vercel production deployment or an end-to-end release.
- Do work in focused branches, verify affected tests and builds, and avoid unrelated refactors.

## Documentation

Begin with the [documentation index](docs/README.md) and [system overview](docs/system-overview.md). `docs/architecture.md` is retained as a cumulative **historical implementation ledger**; older entries may describe states that have already changed. Consult the dated release evidence before making infrastructure or deletion decisions.
