# Activate v2 login (isolated environment)

> **Historical setup guide — not live deployment status (2026-11-04 UTC).** This document records the initial v2 login rollout; references below to missing OAuth/domain/configuration may be outdated. Google OAuth routes and the independent v2 API/database exist in the current source. Verify actual Railway/Vercel environment variables, account migration requirements and live behavior separately. See the [documentation index](README.md) and [system overview](system-overview.md).

The frontend login form is wired to `VITE_API_URL`. The isolated API and PostgreSQL services are deployed; a public API domain, frontend environment variable and migrated identity data are still required.

1. PostgreSQL v2 created and initial schema applied. Archived SQL: `history/database/001_auth_initial_schema.sql`. Never point `DATABASE_URL` at the production v1 database.
2. API service deployed on Railway from `apps/api` with:
   - `DATABASE_URL`: private v2 database connection string
   - `WEB_ORIGIN`: exact v2 frontend origin, e.g. `https://1ce-v2-tofdidthat.vercel.app`
   - `PORT`: assigned by the hosting provider
   - `DATABASE_SSL=true` only if the database requires verified TLS
3. Generate an HTTPS domain in Railway API service → Settings → Networking → Public Networking → Generate Domain. Verify `https://YOUR-DOMAIN/health` returns `ok: true`.
4. In the **v2 Vercel project only**, set `VITE_API_URL` to the deployed HTTPS API origin (without trailing slash), then redeploy.
5. To allow existing v1 accounts to sign in, migrate **only approved identity fields** (`id,google_id,email,password_hash,email_verified,name,picture,custom_picture,created_at,updated_at`) through a secure, separately authorized export/import into v2. Do not migrate sessions or OAuth tokens. Do not grant v2 direct read/write access to production.
6. Verify a migrated email/password account and test `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, and `/app/library` in a browser. Confirm cookies are HttpOnly and Secure.

Limitations: Google OAuth, sign-up, password reset and email verification workflows are not implemented. Google-only accounts cannot sign in until v2 OAuth is configured. This is a staging implementation and needs integration tests and security review before public launch.
