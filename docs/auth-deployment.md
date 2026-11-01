# Activate v2 login (isolated environment)

The frontend login form is wired to `VITE_API_URL`, but authentication will not work until an independent API and PostgreSQL database are deployed.

1. Provision a **new** PostgreSQL database for v2. Never point `DATABASE_URL` at the production v1 database.
2. Run `apps/api/sql/001_auth.sql` against the new database.
3. Deploy `apps/api` as a persistent Node.js service (for example, a separate Railway service) with:
   - `DATABASE_URL`: private v2 database connection string
   - `WEB_ORIGIN`: exact v2 frontend origin, e.g. `https://1ce-v2-tofdidthat.vercel.app`
   - `PORT`: assigned by the hosting provider
   - `DATABASE_SSL=true` only if the database requires verified TLS
4. In the **v2 Vercel project only**, set `VITE_API_URL` to the deployed HTTPS API origin (without trailing slash), then redeploy.
5. To allow existing v1 accounts to sign in, migrate **only approved identity fields** (`id,google_id,email,password_hash,email_verified,name,picture,custom_picture,created_at,updated_at`) through a secure, separately authorized export/import into v2. Do not migrate sessions or OAuth tokens. Do not grant v2 direct read/write access to production.
6. Verify a migrated email/password account and test `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, and `/app/library` in a browser. Confirm cookies are HttpOnly and Secure.

Limitations: Google OAuth, sign-up, password reset and email verification workflows are not implemented. Google-only accounts cannot sign in until v2 OAuth is configured. This is a staging implementation and needs integration tests and security review before public launch.
