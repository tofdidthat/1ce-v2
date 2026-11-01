# 1CE v2 architecture

Monorepo with `apps/web` (React + Vite), `apps/api` (Node.js), and future shared packages.

## Phase 1 scope
- English only.
- Landing: header/footer, empty body.
- Login and registration: UI placeholders until isolated auth service is implemented.
- Terms and Privacy: placeholders until current legal text is reviewed and migrated.
- Library: non-operational UI scaffold.
- No R2, publishing, OAuth destinations, or production database connections in this phase.

## Safety
- Never point the v2 app at the production PostgreSQL database for writes.
- Preserve user IDs and password hash compatibility when migrating identity data.
- Do not modify `1ce` or `1ce-server` repositories.
