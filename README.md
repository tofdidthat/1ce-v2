# 1CE v2

1CE v2 is an independent music-project platform. The monorepo contains a React + TypeScript frontend, a Node.js API, a PostgreSQL database model and private Cloudflare R2 storage.

**Documentation:** This README is the entry point. [Architecture and release guide](docs/architecture.md) is the canonical current status, decisions, module map and prioritized audit. [Instagram runbook](docs/instagram-integration.md) covers OAuth, Reels, private R2 delivery and safety. [Domain cutover log](docs/domain-cutover-1ce-lol.md) retains the migration evidence and historical GO/NO-GO checklist. Old dated checkpoints below these current sections are historical, not deployment instructions.

## Current production checkpoint (2026-11-16)

- **Official site:** [https://1ce.lol](https://1ce.lol), deployed from `tofdidthat/1ce-v2` main to Vercel. The checked project alias points to deployment `dpl_FbmUpKoxtFkc4UJ96WGKaeB7FTgM` for main `37c9d6a` ([PR #103](https://github.com/tofdidthat/1ce-v2/pull/103)). The old v1 site remains separate at its fallback hostname; **the domain switch did not import v1 users or files**.
- **Runtime:** Railway API `https://1ce-v2-production.up.railway.app` and PostgreSQL both reported online and SUCCESS in the read-only 2026-11-16 check. Cloudflare R2 remains the private-media store; the browser uses signed, time-limited PUT URLs.
- **Publishing:** YouTube image + MP3/WAV with 9:16 Shorts, 16:9 standard video and selectable `private` / `unlisted` / `public`; Instagram Business Login (reusing the registered v1 Meta app) and **public Reels** are implemented on v2 ([PRs #96–#102](https://github.com/tofdidthat/1ce-v2/pulls?q=is%3Apr+is%3Amerged+instagram)). A user reported a real Instagram Reel published and history showed `Uploaded`; this verifies one happy-path example, **not** Meta App Review for external accounts or fault recovery. TikTok, Telegram and Discord are **selection previews**, not publishers. Original video submission remains unavailable.
- **Upload UI:** One Destinations button; YouTube 9:16/16:9 choices live under the `⋯` on YouTube, to the **left** of Disconnect. The right media preview uses the v1-like 342.2px maximum width, with 16:9 above 9:16 when both are selected.
- **Safety:** Instagram posts are public; the actual submit button says so, without a redundant confirmation checkbox. Server requires `instagramPublicConsent:true` on an explicitly submitted Instagram job and `INSTAGRAM_REELS_ENABLED=true`. YouTube privacy is independent. Connecting a platform or selecting a destination does not publish.
- **CI:** PR #103 was merged after **7/7 GitHub Actions checks**. These checks do not prove R2 CORS, Meta callback lifecycle, provider timeouts or dual-account browser isolation. The owner fixed a browser R2 PUT failure after reviewing the bucket's CORS policy; the exact Cloudflare rule was not independently inspected.
- **Next:** Close the [2026-11-16 technical audit in the architecture guide](docs/architecture.md) before adding providers: Meta deauthorization/data-deletion callbacks, delivery-token log redaction, ambiguity/crash recovery, and end-to-end tests. Backup restore and coordinated production credential rotation remain separate operational follow-ups.

## Repository structure

| Directory | Responsibility |
| --- | --- |
| `apps/web/` | Vite/React frontend, UI components, styling and frontend tests |
| `apps/api/` | Node.js API, authentication, uploads, media, Trash and backend tests |
| `apps/api/src/library-read-metadata.ts`, `library-streaming.ts` | Private metadata and streaming GET handlers behind the authenticated facade |
| `history/database/` | v2 SQL migrations and guarded historical application scripts |
| `scripts/` | Dependency and repository audits |
| `.github/workflows/` | CI, API tests, disposable PostgreSQL smoke, frontend builds |
| `docs/architecture.md` | **Canonical technical decisions, current audit and release reference** |
| `docs/instagram-integration.md` | Instagram Business Login, Reel publishing and security runbook |
| `docs/domain-cutover-1ce-lol.md` | Domain transition evidence and historical gates |

The original v1 application, database, buckets and repository remain outside the v2 data/deployment boundary. The **existing Meta developer app registration and Instagram client credentials** were deliberately reused for v2 Business Login, without copying v1 users' access tokens or touching v1 data.

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

Copy only the **variable names** from `apps/web/.env.example` and `apps/api/.env.example`; configure environment-specific secrets outside Git. `VITE_API_URL` must point to the intended **v2** API. Do not reuse v1 database, sessions or R2 credentials; the already approved shared Meta Instagram app is a documented exception. Never commit or paste secrets.

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
