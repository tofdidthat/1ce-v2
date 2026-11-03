# 1CE v2

Independent rebuild of 1CE. The production v1 application and database must remain untouched.

## Project structure

- `apps/web/` — React + Vite frontend deployed on Vercel.
- `apps/api/` — Node.js API deployed on Railway; email/password auth and sessions.
- `docs/` — current architecture and setup instructions.
- `history/` — archived, already-applied scripts and historical records. Not part of app builds.

## Deployment status

- Frontend: Vercel project `1ce-v2`.
- API: Railway v2 service (Node.js).
- Database: independent Railway PostgreSQL, with initial schema applied.
- Still required: public API domain, Vercel `VITE_API_URL`, account migration and end-to-end tests.

See [auth deployment](docs/auth-deployment.md).

## Local development and reproducible checks

Use Node.js 22+ and the repository-pinned **pnpm 10.18.0** (see `packageManager` in the root `package.json`). Run from the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm dev:web
pnpm --filter @1ce/api dev
```

The same frozen workspace lockfile is enforced by GitHub Actions (with `--ignore-scripts` in CI). Before a PR:

```sh
pnpm --filter @1ce/api test
node --experimental-strip-types --test apps/web/test/*.test.mjs
pnpm --filter @1ce/web build
```

Google login and sessions are implemented in v2. Signup and password recovery are separate product work. Always use isolated v2 development credentials; never use v1 production credentials locally. Mocked auth/upload regression tests make **no** request to real PostgreSQL, Google or Cloudflare R2 services. Refer to `docs/architecture.md` for security-release gates and unresolved upload-hardening items.
