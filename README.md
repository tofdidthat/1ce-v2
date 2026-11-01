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

## Local development

Node.js 22+ and pnpm 10+:

```sh
pnpm install
pnpm dev:web
pnpm --filter @1ce/api dev
```

Never use production v1 credentials in local or v2 environments. The Google login, signup and password recovery flows are not yet implemented.
