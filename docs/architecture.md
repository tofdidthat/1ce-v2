# 1CE v2 — Architecture, operations and release guide

> **Canonical technical reference.** Last consolidated on 2026-11-04 UTC from `main` at `9f0bd2c89e49a3d332e11e805799c07710a47ace`. It describes repository source and dated operational evidence, **not** an automatic report of the live Railway/Vercel deployments. Recheck GitHub, Railway, Vercel and Cloudflare before making release or deletion decisions. Previous Markdown ledgers remain available via Git history and their pull requests; they are intentionally not kept as separate files.

## 1. Mission, boundaries and product decisions

- **v1 is strictly read-only.** Do not change the v1 repository `tofdidthat/1ce`, production site, database, bucket, tokens, OAuth clients, domains or sessions while working on v2. Migration of approved identity/user data requires a separate plan and authorization; never import v1 sessions or OAuth tokens.
- **v2 repositories:** frontend + API source in `tofdidthat/1ce-v2`; Vercel project `1ce-v2`, Railway project `courteous-spontaneity` and a separate v2 PostgreSQL database.
- **UI labels and design:** Home is the former Library, World is the former Discover. The app UI is English. Reuse existing components, iconography and CSS. Do not split beats and packs into redundant Library sections. The music player/queue, waveform and current playback must survive navigation and data refresh.
- **Original media, no copies:** packs reference their member beats; publication, saves and sharing create relationships rather than duplicate audio/cover/stems objects.
- **Storage plan:** the provisional technical default is **10 GiB per account** in the database plan model; this does not authorize paid tiers, pricing, billing or Stripe integration.
- **Files and operations:** prioritize safe, reversible batches and explicit server-side ownership validation. Production API source is now TypeScript, compiled under `strict:true` and `allowJs:false` to `apps/api/dist/`.

## 2. Code map

| Responsibility | Current paths |
| --- | --- |
| Frontend routes and session entry | `apps/web/src/main.tsx` |
| Workspace, Home, World, upload views | `apps/web/src/workspace-v1.tsx`, `world-v2.tsx`, `library-upload-v1.tsx` |
| Home UI and persistent playback owner | `apps/web/src/library-items-v2.tsx` |
| Source-authorized Home/pack read adapter | `apps/web/src/library-home-api-v2.ts`; normalization in `project-read-v2.ts` |
| Stateless global player UI | `apps/web/src/player-dock-v2.tsx`; player CSS remains in `library-items-v2.css` |
| Owner-keyed waveform preload and React hook | `apps/web/src/player-waveform-v2.ts` |
| Shared project grid tokens and menu styles | `apps/web/src/project-grid-tokens-v2.css` (imported by `project-card-v2.tsx`), `project-context-menu-v2.css` (imported by `project-context-menu-v2.tsx`) |
| Project menu and actions | `apps/web/src/project-context-menu-v2.tsx`, `project-action-dialog-v2.tsx`, `project-requests-v2.ts` |
| Cover and project data | `apps/web/src/project-cover-v2.tsx`, `project-cover-cache-v2.ts`, `project-read-v2.ts` |
| Profile views / presentation | `apps/web/src/public-profile-v2.tsx`, `public-profile-v2.css`, `edit-profile-panel-v2.tsx` |
| Viewer-target-scoped Follow/Following state | `apps/web/src/use-profile-follows-v2.ts` (frontend), `profile-follows-v2.ts` (transport) |
| Settings and Trash UI | `apps/web/src/account-settings-v2.tsx`, `trash-settings-v2.tsx` |
| Frontend data refresh | `apps/web/src/data-refresh-v2.ts` |
| API entry, auth/sessions/OAuth | `apps/api/src/server.ts` |
| Private uploads and Library files | `apps/api/src/library-files.ts`, `upload-security.ts`, `upload-leases.ts` |
| Project mutations | `apps/api/src/project-actions.ts` |
| Trash, restoration and R2 outbox | `apps/api/src/trash.ts` |
| Public profiles, saves, publications, links | `apps/api/src/public-profiles.ts`, `profile-identity.ts`, `profile-follows.ts` |
| Access-controlled media and ranges | `apps/api/src/project-media.ts`, `audio-stream.ts` |
| Quotas and API rate limiting | `apps/api/src/storage-plans.ts`, `api-rate-limits.ts`, `login-admission.ts` |
| SQL migrations and isolated smokes | `history/database/`, `apps/api/scripts/`, `apps/api/test/`, `apps/web/test/` |

The entry point `apps/api/src/server.ts` (emitted as `dist/server.js`) delegates to feature handlers, which must perform authorization **again on the server**. File IDs and project IDs are not interchangeable; project identity should include owner, kind and project ID. Preserve existing HTTP routes until frontend consumers have migrated and been regression-tested.

### Frontend behavior and media access

- Home lists owned standalone beats and packs; a pack-only beat must not appear as an extra standalone card. A beat previously visible individually remains so when added to a pack.
- Profile Catalog/Saves/Following use viewer-appropriate visibility. A **Save** is not by itself a permission grant to stream a private asset; publishing or an explicit share grant establishes access. Private media stays in R2 and is served only through authorized backend endpoints.
- Audio streaming supports standard and byte-range responses; verify `200`, `206`, `416` and cache/security headers. Stems must remain owner-restricted until a separate access policy is expressly approved.
- Use shared refresh notifications and source-backed project identity. Do not reset upload destinations, player state or project listing on routine refresh. Test rapid navigation, playback, saves, shares and profile changes in two distinct browser sessions.


### Player and Home maintainability boundaries (PR #63 merged; user-confirmed in production 2026-11-05)

The v2 Home component is a **persistent playback coordinator**, not just a page. The Workspace renders **exactly one** `LibraryItemsV2` instance and keeps it mounted while switching Home, World, Upload, Settings, and Profile. Preserve the single `<audio ref={audioRef}>` portal and its owner-scoped `current`, queue, elapsed/duration, repeat/shuffle/volume, account-switch cleanup, and profile-origin requests. Do not move audio to a conditional per-page component or add a second audio element.

- **`player-dock-v2.tsx` is purely presentational.** It receives current playback data and typed callbacks; it renders the existing waveform/transport/volume/queue DOM with the same classes and accessible labels. No hook, storage write, fetch, new audio, or portal lifecycle belongs here. CSS values and design must remain unchanged in this refactor.
- **`player-waveform-v2.ts` owns the existing browser-only decoding and bounded 16-item waveform cache.** Cache/in-flight request IDs include both original owner and file ID. Closing the temporary `AudioContext` after decoding, silent visual waveform failure, and warming waveform before playback are intentional. Never cache private audio or cover bytes in persistent browser storage.
- **`library-home-api-v2.ts` reads the existing authorized v2 endpoints and normalizes pack tracks.** Do not use v1 endpoints or bypass auth with frontend assumptions. `LibraryItemsV2` still owns viewer-scoped `loadedViewerId`, abort-on-revalidation, handling HTTP 401/403 by clearing private Home metadata, refresh notifications, and retained cards during same-viewer revalidation. Only a verified current viewer's data becomes visible.
- **`playback-queue-v2.ts` remains the pure source-backed ordering/identity helper**; beat identity is `owner_id + id`, no duplicate media files, no accidental rearrangement of pack order. `project-card-v2.tsx` remains the one shared card for Home and Profile.

**Completed historical validation:** PR #63 (`af2817d` squash) merged with all 7 CI jobs passing and Vercel production READY. On 2026-11-05, the user reported that player/Home were functioning after testing, authorizing the next CSS/profile refactor. This report is not equivalent to automated multi-account browser E2E coverage; continue testing queue, seek, repeat, profile requests, session changes and upload refresh before further risky logic changes.



### Shared CSS and Public Profile maintainability (CSS/Profile refactor phase)

- `project-grid-tokens-v2.css` is the **single source of the approved ProjectCard grid geometry** for Home and Public Profile: desktop card 216px, 32px gap, 960px maximum grid, 14px artwork radius/title, and two-column mobile rules at 600px (20px row gap, 14px column gap). `ProjectCardV2` imports the token stylesheet so both consumers receive it. The structural selectors remain scoped to their own view; Home and Profile use `var(--onece-project-...)` rather than independent numeric overrides. When changing card dimensions, update tokens + both responsive tests and verify small screens. Do not enlarge only one view without an explicit product decision.
- `ProjectContextMenuV2` alone imports `project-context-menu-v2.css`. No other component should import Home's `library-items-v2.css` simply to obtain menu rules. Old unused `.onece-profile-context-menu` styles are retired. Keep the shared menu actions, owner/visitor authorization callbacks and order unchanged.
- `public-profile-v2.tsx` owns profile identity verification, visible Catalog/Saves state, owner-only project actions and rendering. `use-profile-follows-v2.ts` owns Follow/Following status, fetch cancellations, refresh subscriptions, stale viewer/target protection, follow/unfollow mutation, error retry and busy state; `profile-follows-v2.ts` remains its network adapter. Follow changes must never bypass server permissions, leak stale users, allow owner follow, or create access grants.
- **No visual redesign:** same avatar/tab positions, link placement, play button, media access behavior, 1CE purple palette, mobile card geometry and player single-instance state. CSS-specific and profile hook tests must remain green. Version the architecture and tests when moving source so that AI assistants see the *actual* code owner rather than copy obsolete logic into the view.
- A green static contract CI is not proof of actual browser rendering: test profile Follow/Unfollow, Catalog/Saves, viewer switch, card positioning and context actions plus player continuity on final production after approved merge.

### Cautious API refactor — design only; DO NOT implement or deploy with CSS/Profile work

**Motivation:** `apps/api/src/library-files.ts` is roughly 368 lines but is a security-critical dispatcher. It combines owner-only beat/pack writes; authorized audio/stems/cover/items/pack reads; R2 signed `init`; verification and concurrent `complete` with DB leases. **A file length alone is not authorization to change these behaviors.** The other existing boundary modules (`upload-security.ts`, `upload-leases.ts`, `project-media.ts`, `project-actions.ts`, `trash.ts`) should remain separate, not be folded into another facade.

**Sequence (new, independent branches and review checkpoints):**

1. **Read-only inventory and response contracts.** Map every `/api/library/files/*` route, method, input parser, ownership filter, R2 operation, DB transaction, status code, cache/security header and consumer. Verify current PostgreSQL schema and CI source before designing changes. Record whether access requires owner, published, share grant or explicit owner-only stems. Identify existing tests and missing cases.
2. **Characterization tests, before any extraction.** On disposable PostgreSQL, test malformed payloads, wrong owners/two accounts, session expiry (401/403), pack-only vs standalone, shared covers and stems, no duplicate media, ordering, quota, expired signed URLs, invalid content type and file dimensions, hash/dedup and request limits. Add deterministic tests for concurrent `complete` with lease fencing and stale ETag/CopySourceIfMatch, `200/206/416` audio range and R2 error handling. Establish baseline responses and timestamps before making code moves.
3. **Extraction by behavior, not wholesale rewrite.** Prefer small pure validation/response helpers and `GET` handlers first. Retain `handleLibraryFiles(req,res,pathname,pool,currentUser)` as the stable route facade, with the same endpoint names, response shapes, checks and authorization order. Do not move the single source of ownership enforcement into the browser. No SQL migrations.
4. **Only after read paths pass:** isolate beat/pack project creation transactions, then `init` upload validation and quota reservation. Keep DB advisory locks, readiness checks, owner+kind-scoped object identity, pending expiry, and verification immutable.
5. **`complete` is the final/highest-risk batch.** Never loosen lease-token fencing, share PG locks across long R2 requests, skip object signature/hash/size checks, or turn a failed or uncertain copy into READY. Require independent review of all terminal transitions and reconciliation semantics. No automatic deletion or write to old v1 media.
6. **Isolated integration and deployment.** Every batch: TypeScript strict build, Node 22/26 web CI, API suite, disposable PG tests and dedicated temporary R2 canary only with opt-in credentials. Test real signed PUT, HEAD, conditional copy, Range, corrupt objects, concurrent completion, wrong-owner access and sibling-object survival. Check response parity, production health and logs. User approval separately before any production merge/deploy; automatic Vercel/Railway builds from main should be considered. Never conduct destructive smoke tests against users' production objects. Preserve a rollback commit and distinguish reversible code rollback from non-reversible media deletion.

**Separate phase dependency:** Do not mix this API refactor with OAuth, social publishing, domain cutover, Create Video or new storage plans. First lock current contracts; publication workers and job queues require their own architecture and separate acceptance criteria.


## 3. Database, storage and migrations

**Primary relational model:** `account_users`, `account_sessions`, `library_files`, `library_beats`, `library_packs`, `library_pack_beats`, and public/saves/access/share relationship tables. A beat references its original audio plus optional cover and stems. Packs reference existing beats and optionally a cover; ordering lives in `library_pack_beats`. `library_files` stores owner, object key, kind, size, hash/status and other metadata — **not binary media**. Deduplication is scoped to account and file kind; shared references must not cause a second R2 upload.

All versioned SQL stays in `history/database/`. **Do not rename, reorder or delete those files** during documentation housekeeping. The sequence contains `001` through `012` and two historical `004_...` files with distinct purposes; always inspect exact filenames and previously applied state instead of inferring from a number alone.

**Dated production v2 evidence (2026-11-03):**

- `010_api_rate_limits.sql` applied in v2 production, for API/login quotas and rate limits.
- `011_storage_plans_completion_leases.sql` applied in v2 production, adding default 10-GiB plans and per-file completion leases.
- `012_trash_and_r2_delete_outbox.sql` applied and checked **6/6** against v2 production PostgreSQL; the temporary Railway executor was removed. The guarded `012_trash_and_r2_delete_outbox_safe_psql.sql` is for reviewed, operator-controlled use with `psql`, **not** a reason to apply the migration again.
- These production migration statements are historical **observed** evidence; verify current database state read-only before any new migration. Never execute them on v1.

**R2 contract:** store each user's media beneath `users/<numeric-owner-id>/` using verified audio/cover/stems object keys. Signed staging uploads must be verified before promoting immutable READY media. No client-supplied object key may authorize deletion. The R2 `staging/` lifecycle expiration after 24 hours was **reported configured by the user**; it is separate from Trash's 30-day restore window and does not authorize expiration under `users/` or `verified/`. Keep R2 credentials, bucket policy, signed URLs and backups private.

**Upload safety:** check ownership, verified media signatures, size/limits, hash-based deduplication, concurrent-completion leases, advisory locking and rate limits; fail closed on validation/ETag mismatch. A read-only orphan audit exists at `apps/api/scripts/s2-orphan-audit.mjs`; it lists only candidates. It is **not** a destructive sweeper and does not substitute for a separately authorized cleanup design.

## 4. Trash: behavioral contract and permanent-deletion safety

[PR #28](https://github.com/tofdidthat/1ce-v2/pull/28) is **merged into main** as of 2026-11-04 UTC. This is a source-control fact, **not** proof the feature was independently verified end to end or that a specific production deployment is running it.

- **Delete** soft-deletes a beat or pack (`deleted_at`), hides it from Home/public lists/playback, and revokes publishing, saves, grants and share links. The owner has a **30-day restore window**. Restore does not republish or reinstate revoked grants.
- **Pack cascade:** deleting a pack also soft-deletes beats that were not standalone and have no other live pack; standalone/shared beats are preserved. The parent and cascaded beats share a deletion marker. Restoring the pack revives only beats that were automatically cascaded, not beats the owner had manually deleted.
- **Empty Trash:** owner-only, requires typed `EMPTY TRASH`. The metadata transaction removes trashed projects, checks all remaining beat/pack references and retires only unreferenced **READY** `library_files` with an owner-matching `verified/` key. Foreign keys (`ON DELETE RESTRICT`), owner-level advisory locks and the transactional `v2_r2_delete_jobs` outbox protect shared objects.
- **R2 deletion happens after COMMIT:** worker processes bounded jobs (at most 12 per request), claims jobs with a lease, validates strict owner-scoped keys and records completion or retry state. A partial R2 failure is **not success**; remaining jobs are reported and retried by an explicit subsequent Empty Trash. No automatic expiry purge and no historical orphan sweep are implemented.
- **Do not ever** delete a whole `users/` prefix, a different owner's object, `staging/`, an attached file or an unverified key. An R2 DeleteObject that succeeds cannot be undone by a Git revert, SQL rollback or deploying an older API.

**Required full application acceptance (not established by the infrastructure canary):** test Delete → Trash → Restore and Delete → Empty Trash from the UI and API in an isolated environment with disposable assets. Include pack-only vs standalone/shared beats, shared covers and stems, published/saved/shared links, unauthorized users, player/queue, quota changes, pending/failed R2 jobs, simultaneous project writes, stale session, R2 5xx retry and private media access after soft delete. Independently review destructive SQL and races. Never use real user media for acceptance testing.

## 5. Auth, access and API release health

- Backend login/session credentials belong only in Railway secrets, never Git or frontend code. Google OAuth is wired in the API; it depends on correctly scoped OAuth secrets and redirect URI. Password recovery and signup must not be claimed complete without source and E2E verification.
- `GET /health` should return `200`, `{"ok":true,"service":"1ce-v2-api"}`; `GET /health/db` should return `200`, `{"ok":true,"database":"connected"}`. `GET /auth/me` without a session should return `401`; untrusted browser Origins should be refused. Inspect cookie, CORS, `Cache-Control: no-store`, runtime logs and error rates.
- v2 frontend uses `VITE_API_URL` pointing to the HTTPS API; the API uses a v2-only `DATABASE_URL`, private R2 credentials, `WEB_ORIGIN` and relevant Google OAuth configuration. Never paste any values into documentation.
- Public account profiles accept approved usernames and numeric IDs; avatar identity changes must not alter project covers or ownership. Username constraints and the associated migration are defined by current identity handlers and `007_profile_identity.sql`.
- Before deploy, check actual commit SHA, GitHub CI, Railway staged changes, current deployment/rollback candidates, correct v2 database/bucket and Vercel production configuration. **Merging `main` may automatically trigger Railway/Vercel builds.** A green CI run alone does not prove a successful deployment or browser acceptance.

## 6. Verified release evidence and remaining unknowns

| Evidence (UTC) | Result | Scope and limitations |
| --- | --- | --- |
| [PR #27](https://github.com/tofdidthat/1ce-v2/pull/27), 2026-11-03 | **Merged** | Upload/R2 security, 010/011 quota/lease protections. Source merge is distinct from runtime verification. |
| [PR #28](https://github.com/tofdidthat/1ce-v2/pull/28), 2026-11-04 | **Merged** | Settings Trash, migration 012 and transactional R2 outbox code. |
| [Main workflow 41757434555](https://github.com/tofdidthat/1ce-v2/actions/runs/41757434555), 2026-11-04 | **Success** | Main-branch API/web/dependency and disposable PostgreSQL checks at `9f0bd2c...`. Not a live E2E test. |
| Migration 012 production verification, 2026-11-03 | **Pass (6/6)** | V2 database only; no user-media purge performed as part of applying the schema. |
| Private v2 DB backup, 2026-11-03 | **Archive verified** | Custom PostgreSQL dump in private R2; downloaded/compared; checksum below. |
| Full isolated restore, 2026-11-04 UTC | **`RESTORE_FULL_SUCCESS`** | PostgreSQL 18 disposable container, restored and inspected schema + row counts; no production database writes. |
| Dedicated R2 smoke canary, 2026-11-04 UTC | **`CANARY_SUCCESS_SIBLING_PRESERVED`** | Two uniquely named objects in `onece-s2-smoke-27`; verified delete of one and survival of the other. **Not** a full Trash API/UI test. |

**Backup recovery reference:** R2 private object `db-backups/1ce-v2/20261103T215852Z/postgres-custom.dump`, size **57,413 bytes**, SHA-256 `83dcaa6dc51e580fb4e54d21741b0d24ae488da590f15740b177eb4ead07e0fb`. Backup deployment `ab27fb87-4e14-467d-8bbe-bd6dedbcdedc`; full-restore deployment `1670bf99-b544-49a5-a167-cfd8f5807e3d`. The isolated restore contained 18 public tables, 2 accounts, 11 beats, 1 pack, 23 media records and 24 foreign-key constraints. **This is a point-in-time backup, not continuous backups or a guarantee of zero data loss.** Limit credentials to approved operators; never put a dump in Git.

**Infrastructure R2 canary reference:** disposable bucket `onece-s2-smoke-27`; one-shot Railway deployment `f6b88b41-afab-4ffc-8ee1-c30a16908db5`; PUT, GET, DeleteObject, not-found readback and sibling-object integrity passed. Earlier 403/AccessDenied attempts used the wrong credentials and produced no R2 mutations; scoped test-bucket credentials resolved that. Temporary services were removed.

**Outstanding validation:** independent review of permanent deletion and concurrency behavior, full isolated application-level Trash/Restore/Empty Trash acceptance, and confirmation of the exact Railway/Vercel revisions and manual player/profile/upload checks. Do not silently mark these done because the PRs were merged. CI and GitHub PR state should be rechecked at the then-current HEAD.

**Historical audit:** the full implementation ledgers (old `docs/trash-v2-release.md`, `docs/release-s2-upload-security.md`, S1 rollback checklist, Phase A inventory, identity and playback notes) remain accessible through Git history before this documentation consolidation and through [PR #27](https://github.com/tofdidthat/1ce-v2/pull/27), [PR #28](https://github.com/tofdidthat/1ce-v2/pull/28). This single guide supersedes their old planning checklists; **never execute a historical command without verifying its environment and present applicability**.

## 7. Safe batch, release and rollback protocol

1. **Read before editing:** inspect the current `README.md`, this guide, relevant modules/tests and recent merged PRs. Determine exact product requirement, affected files, permissions, state changes and v1 references. Prefer reusing CSS and components.
2. **Scope the change:** one coherent batch on a dedicated branch. Avoid unrelated frontend files, migration edits or test rewrites. Document intentional changes to product behavior and any unresolved risks.
3. **Validate:** API unit tests, frontend tests, TypeScript typecheck/build, dependency audit and GitHub workflow. Add isolated PostgreSQL/R2 test cases for database/storage behavior. Do not confuse mock tests or successful uploads with production approval.
4. **Before merging/releasing:** verify base/head SHAs and the precise diff, review authorization/storage race paths and assess CI at final HEAD. Obtain explicit user permission for any merge and **separate permission** for runtime/migration changes. Check whether `main` auto-deploys and batch changes to minimize unnecessary deploys.
5. **Post-release smoke:** check Railway API and DB health, Vercel app, sign-in, Home/World, library refresh after uploads, pack and beat context menus, project saves/shares, profile avatar, player/queue/waveform, CORS, privacy and R2/DB pending job counts.
6. **Rollback:** prefer returning API/frontend to a known-good deployment after checking its database compatibility; additive migrations may remain in place. Rollbacks **cannot recreate permanently deleted R2 objects**. If deletion safety is uncertain, disable further destructive operations and preserve evidence before investigating.

### Quick source navigation: v1 visual reference only

The v1 repo `tofdidthat/1ce` is read-only. For a requested visual reference, inspect the actual JSX/CSS there rather than reusing its API endpoints or tokens.

| v1 source (read-only) | Historical responsibility |
| --- | --- |
| `src/workspace/WorkspaceShell.jsx` | Header, Home menu, Discover/World navigation |
| `src/LibraryPage.jsx`, `src/LibraryPage.css` | Library cards, beats/packs, contextual menus |
| `src/GlobalPlayer.jsx`, `src/GlobalPlayer.css`, `src/playback.jsx` | Player bar, queue, Add file behavior |
| `src/upload/LibraryUploadPage.jsx`, `src/upload/LibraryUploadPage.css` | Private library upload UI |
| `src/BeatProfile.jsx`, `src/PublicProfilePage.jsx` | Project details, public profile |
| `src/workspace/ProfileEditor.jsx`, `src/AccountPanel.jsx` | Edit Profile, account Settings |
| `src/routes/AppRouter.jsx` | Legacy app routes |

**Documentation policy:** keep just `README.md` and `docs/architecture.md`. Add new, verified decisions to the appropriate section of this guide; avoid chronological dumps, redundant files and speculative implementation claims. Preserve sensitive operational evidence outside the repo and use Git/PR history to recover older notes.

---

## 8. Plano completo — migração gradual do backend para TypeScript (2026-11-04)

> **Historical migration plan:** the 8.1 inventory describes the starting condition, not the current source tree. Current source paths are in §2; integration checkpoints are in §8.7.

> **Fonte:** transcrição técnica consolidada da resposta e do planejamento aprovados para consulta nas próximas etapas. **Não é autorização de merge/deploy.** Este plano registra a ordem, o esforço, as integrações e as regras que devem ser verificadas antes de cada lote. Atualizar o andamento aqui, sem criar outros arquivos Markdown.

Revisei a estrutura da `main`, módulos do backend, testes, GitHub Actions e configuração Railway. **Recomendação: migrar a aplicação inteira para TypeScript sem conversão em massa.** Agrupar módulos simples, isolando autenticação, permissões, uploads e exclusões permanentes. A API existente precisa continuar funcionando durante toda a migração.

### 8.1 Situação de partida

| Área | Inventário no planejamento | Situação |
| --- | --- | --- |
| Frontend | 27 arquivos `.ts`/`.tsx` | Já usa TypeScript, React e verificação de tipos |
| Backend | 16 módulos `.js` | Executado diretamente pela Railway, sem compilação TypeScript |
| Testes | 39 arquivos (15 API + 24 web) | JavaScript/MJS; testes de API importam `src/*.js` |
| Operação | Build Railway via `node --check apps/api/src/server.js`; start via `pnpm --filter @1ce/api start` | Não basta renomear arquivos para `.ts`; é preciso adaptar build, imports, testes e runtime |

**Primeiro objetivo:** configurar a API compilada e prová-la no CI antes de qualquer troca da entrada em produção.

### 8.2 Prioridades, impacto, tamanho, dificuldade e conectores

Esforço: **P** = pequeno; **M** = médio; **G** = grande; **GG** = muito grande. Impacto crítico significa risco maior se houver regressão, não que o módulo esteja defeituoso.

| Ordem | Migração | Impacto | Esforço | Dificuldade | Conectores |
| --- | --- | --- | --- | --- | --- |
| 1 | Compilação TypeScript da API, CI e execução Railway | Muito alto | M | Alta | Sim; deploy controlado |
| 2 | Tipos compartilhados: Beat, Pack, Project, File e User | Muito alto | M | Média | Sim |
| 3 | Utilitários menores: limites, planos, login admission e profile links | Médio | P–M | Baixa | Sim |
| 4 | Streaming, auditoria de órfãos e follows | Médio | M | Média | Parcial; R2 real |
| 5 | Identidade e permissões de mídia (`profile-identity`, `project-media`) | Muito alto | G | Alta | Parcial; autorização real |
| 6 | Perfis públicos e ações de projetos | Muito alto | G | Alta | Parcial; testes entre contas |
| 7 | Segurança e concorrência de uploads | Crítico | G | Muito alta | Parcial; R2/DB isolados |
| 8 | `library-files.js`, gerenciamento completo de arquivos | Crítico | GG | Muito alta | Parcial; integração real |
| 9 | `trash.js`, lixeira e exclusão permanente | Crítico | G | Muito alta | Parcial; R2 descartável |
| 10 | `server.js`, autenticação/OAuth/servidor principal | Crítico | GG | Muito alta | Parcial; login real |
| 11 | Testes e scripts auxiliares restantes | Médio | G | Média | Sim, quase tudo |

### 8.3 Fases de implementação

#### Fase 1 — Preparar TypeScript sem alterar funcionalidades (infraestrutura isolada)

1. Configurar `tsconfig` da API para Node.js ESM e compilação de JavaScript/TypeScript.
2. Preparar build que gera JavaScript em `dist/`.
3. Adaptar CI e testes que dependem diretamente de `src/`; manter testes de código-fonte e validar também o artefato compilado.
4. Testar a API compilada e **só então**, com aprovação explícita, trocar a execução na Railway.

**Resultado:** infraestrutura de compilação pronta para migração incremental. **Gate especial:** a troca do processo de produção é um release separado; não presumir que autorização para criar branch concede deploy.

#### Fase 2 — Contratos compartilhados e módulos pequenos (lotes conjuntos)

Definir contratos para projetos, usuários, beats, packs, arquivos e respostas da API. Migrar juntos `login-admission.js`, `storage-plans.js`, `api-rate-limits.js` e `profile-links.js`. Em segundo lote, migrar `audio-stream.js`, `orphan-audit.js` e `profile-follows.js`. Verificar exports, `.js` specifiers ESM, tipos e testes existentes.

**Resultado:** contratos centrais e sete módulos convertidos sem redesenhar comportamento.

#### Fase 3 — Identidade, projetos e permissões (quatro revisões separadas)

Migrar `profile-identity.js` (identidade, username, avatar); `project-media.js` (acesso por usuário e recurso); `public-profiles.js` (publicações, compartilhamentos, saves); `project-actions.js` (mutações de beats e packs), com testes em duas contas. Não alterar a política de acesso nem as rotas durante a conversão.

**Resultado:** autorização tipada e contratos existentes preservados.

#### Fase 4 — Uploads e R2 (três revisões separadas)

Migrar individualmente `upload-security.js` (validação e integridade), `upload-leases.js` (concorrência e fencing) e `library-files.js` (uploads, deduplicação, R2, referências). `library-files.js` concentra várias consultas SQL e operações S3, por isso precisa de testes de concorrência em PostgreSQL e R2 descartáveis. Não misturar novos recursos de upload.

**Resultado:** armazenamento tipado sem alterar chaves, mídia, deduplicação ou dados de usuários.

#### Fase 5 — Lixeira e exclusão permanente (exclusiva)

Migrar `trash.js` em branch/revisão própria depois dos contratos e arquivos. Preservar transações, advisory locks, leases, FKs, outbox e limitações de owner-scoped `verified/` keys. Validar Delete → Trash → Restore → Empty Trash com ativos descartáveis; falhas/retries e autorizações negativas. Nunca testar exclusão de mídias reais.

**Resultado:** lixeira tipada com revisão especial de segurança.

#### Fase 6 — Servidor principal e autenticação (núcleo por último)

Migrar `server.js` quando handlers já estiverem tipados. Revalidar HTTP, sessões, cookies, rate limit, Google OAuth, login por senha, health e CORS. Aplicar testes adversariais e verificação de rotas em ambiente autorizado antes de qualquer rollout.

**Resultado:** todos os 16 módulos de produção da API em TypeScript.

#### Fase 7 — Testes, scripts e acabamento (lotes opcionais)

Migrar testes JavaScript que ganhem valor com tipos, e avaliar scripts `.mjs` usados em manutenção. Cobertura necessária ao comportamento deve ser criada **durante** as fases anteriores; a fase 7 apenas completa a padronização conveniente.

### 8.4 Capacidades dos conectores e limitações

| Atividade | Execução pelos conectores | Condição |
| --- | --- | --- |
| Editar arquivos, branches, commits, PRs | Sim | GitHub |
| Executar testes e builds | Sim | GitHub Actions |
| Configurar build/start da API | Sim | Railway; exige autorização de deploy |
| Acompanhar deploys | Sim | Vercel/Railway |
| PostgreSQL e R2 descartáveis | Em grande parte | Isolamento e credenciais adequadas |
| Login Google, interações e reprodução em navegador | Parcial | Algumas etapas exigem sessão/teste manual |
| Garantia de zero regressões | Não | TypeScript, testes e CI reduzem risco, não o eliminam |

Maior dependência externa: **validação de comportamentos reais entre contas, R2 e banco**, com ambientes isolados e credenciais instaladas diretamente nos serviços, sem exposição em chat ou Git.

### 8.5 Lotes, deploys e pontos de aprovação

- **Marco A — infraestrutura pronta:** compilação TypeScript e CI funcionando; publicar a troca de runtime somente após teste da API compilada e autorização.
- **Marco B — módulos de menor risco:** contratos e utilitários migrados, agrupando alterações relacionadas em poucas publicações.
- **Marco C — módulos críticos:** permissões, uploads, lixeira e autenticação revisados isoladamente; não forçar tudo em um deploy para economizar builds.
- Cada fase tem branch/PR e teste próprio. Nenhum merge ou deploy automático por iniciativa do assistente. A infraestrutura pode ter deploy automático ao mesclar `main`; checar o mecanismo antes de autorizar merges.

### 8.6 Regras permanentes da migração

1. **Sem alteração intencional de comportamento:** mudar a linguagem/contratos, não adicionar funções.
2. **Sem migration SQL por padrão:** TypeScript não exige mudar as tabelas.
3. **Sem `any` indiscriminado:** usar tipos, `unknown` e validação em runtime nas fronteiras.
4. **Preservar R2 e autorização:** sem reprocessar arquivos ou mudar keys, grants, dedupe e política de acesso.
5. **Só dois Markdown:** `README.md` e `docs/architecture.md`; documentar progresso nesta seção.
6. **Validação por lote:** API, testes web, compilação, CI e testes PostgreSQL/R2 conforme risco; distinguir mock de teste real.
7. **Sem merge/deploy sem autorização específica:** a migração precisa preservar as funcionalidades em produção durante o trabalho.

### 8.7 Recomendação e andamento

**Situação consolidada em 2026-11-04 (UTC).** Os registros abaixo distinguem CI, compatibilidade R2 real, disponibilidade de produção e testes manuais. O status efetivo de cada PR deve ser conferido no GitHub.

- **Fases 1 e 2 — publicadas:** PR #30 (https://github.com/tofdidthat/1ce-v2/pull/30, 5e75afb) e PR #31 (https://github.com/tofdidthat/1ce-v2/pull/31, eb505e6): API compilada em TypeScript, iniciada com node dist/server.js, contratos compartilhados, tipagens Node e módulos básicos convertidos.
- **Fase 3 — publicada em ordem controlada:** PR #32 (f190278), #33 (8930f34), #35 (535899b) e #34 (fd27b7e): permissões, mídia, identidade, perfis, Saves/shares e projetos. CI main 41773946388: 6/6; Railway SUCCESS, frontend preservado.
- **Fase 4A — publicada:** PR #36, merge e64936c2dc594947be89bdb645e55808121aac07. upload-security.ts preserva SHA-256, MP3/ZIP/imagens, limites de expansão, GET Range e deadlines. CI main 41775809348: 6/6; Railway SUCCESS.
- **Fase 4B — publicada:** PR #37, merge 3c1a5663040536c4c9ef49bf96d35134be64ccbe. upload-leases.ts preserva fencing por proprietário/token, FOR UPDATE, clock_timestamp(), expiração e transições READY/FAILED. CI main 41776026915: 6/6; Railway SUCCESS.
- **Fase 4C — publicada e verificada em produção:** [PR #38](https://github.com/tofdidthat/1ce-v2/pull/38), squash d06a0d20bbbcd629429ac0737677ce730d962c4c. library-files.ts protege quotas e locks por proprietário, deduplicação READY, referências únicas para beats/packs, staging PUT assinado, verified COPY condicional com ETag, verificação SHA, lease fencing e limpeza restrita. Testes cobrem permissões, ownership de capas/stems, beats existentes e visibilidade em packs. Integração em PostgreSQL 16 descartável verifica 11 inicializações concorrentes frente ao limite de 10, isolamento entre contas e referências sem cópias duplicadas. [CI PR 41778848610](https://github.com/tofdidthat/1ce-v2/actions/runs/41778848610): 7/7. [CI main 41903125266](https://github.com/tofdidthat/1ce-v2/actions/runs/41903125266): SUCCESS. Railway deployment 9647d629-07b9-449b-98ca-c8740f122c02: SUCCESS; GET /health e GET /health/db aprovados.
- **Cloudflare R2 real da Fase 4C — PASS confirmado pelo operador em 2026-11-04:** teste local apps/api/scripts/s2-r2-smoke.mjs executado com token restrito ao bucket isolado onece-s2-smoke-27, sem acessar mídia de produção. O operador relatou saída PASS no PowerShell. O script valida PUT assinado, HEAD/ETag, CopyObject com CopySourceIfMatch, GET Range, SHA-256, isolamento de verified após sobrescrita de staging, rejeição de ETag antigo 412 e limpeza DELETE dos próprios objetos. A saída bruta não foi capturada pelo CI: registrar como validação real atestada pelo operador, NÃO como teste automatizado. Credenciais não foram inseridas no repositório. O job s2-local-s3-syntax-preflight continua APENAS sintático e distinto do teste real R2.
- **Fase 5 — publicada e verificada em produção:** [PR #39](https://github.com/tofdidthat/1ce-v2/pull/39), squash a27835c93f1857a4644799c49589f47ade448d5a. trash.ts mantém restauração de 30 dias, cascata de tracks, retenção de arquivos compartilhados e outbox durável para exclusão, com fencing por proprietário/token. Checkpoints 5A 30e91af, 5B 588f30f e 5C f0519c5; testes negativos de ownership e concorrência. [CI PR 41780547080](https://github.com/tofdidthat/1ce-v2/actions/runs/41780547080): 6/6. [CI main 41903740692](https://github.com/tofdidthat/1ce-v2/actions/runs/41903740692): SUCCESS. Railway deployment 9960cd9a-21ac-4a26-af7e-14b381af31e5: SUCCESS; GET /health e GET /health/db aprovados, sem alterações de esquema ou mídia real durante testes.
- **Fase 6 — [PR #40](https://github.com/tofdidthat/1ce-v2/pull/40), merged 2026-11-04:** server.js passa a server.ts com tipagens Node/PostgreSQL oficiais (@types/pg 8.15.5), preservando CORS, autenticação Google state/PKCE, sessão de código single-use, cookies Secure/HttpOnly/SameSite, login scrypt, rate limiting, /health, /health/db e porta do Railway. Testes de OAuth/sessões/seguidores e compilação devem passar no estado reconciliado com as fases 4C e 5. A reconciliação deve preservar os jobs PostgreSQL real e preflight S3 da 4C, garantir zero arquivos JavaScript em apps/api/src e atualizar tsconfig allowJs:false com strict:true. Após qualquer merge, verificar CI da main, Railway SUCCESS e os dois endpoints. O status do merge deve ser conferido no GitHub.
- **Composição previamente validada:** [PR #41](https://github.com/tofdidthat/1ce-v2/pull/41) é SOMENTE uma branch de verificação (NÃO MERGE); integrou em teste os três módulos 4C+5+6 com allowJs:false e [CI 41782458089](https://github.com/tofdidthat/1ce-v2/actions/runs/41782458089) 7/7. Serviu de referência para a reconciliação, não para deploy direto.
- **Política TypeScript-first:** após a Fase 6, zero arquivos .js na pasta apps/api/src; a compilação usa allowJs:false e strict:true, com guarda CI. Scripts .mjs e testes .js fora da pasta src não são módulos da API de produção e podem permanecer. Manter arquitetura monorepo, v1 ativa, dados por proprietário no Cloudflare R2 e mídia deduplicada por referência.
- **Limites e próxima validação de produto:** CI + /health + /health/db não equivalem a testes manuais completos de login Google, uploads reais, streaming, share links, permissões entre duas contas, restores/packs/stems e exclusão. Essas jornadas exigem validação adicional não destrutiva. Não realizar exclusões de produção para demonstrar comportamento.
- **Protocolo de lotes e rollback:** consultar este guia antes de implementar; alterações em branches pequenas, build/testes, CI na HEAD da PR, merge individual somente quando autorizado, CI da main + Railway SUCCESS + HTTP health + banco conectados sem alertas antes da PR seguinte. Preservar rollback por commit e reduzir rebuilds Vercel desnecessários. Manter apenas README.md e docs/architecture.md como Markdown no repositório.

**Status atual:** Fases 4C, 5 e 6 receberam merge individual (#38, #39, #40). A CI da PR #40 passou 7/7. A compilação `src/server.ts` → `dist/server.js` é intencional. A validação completa da interface e do armazenamento ainda não pode ser inferida do CI. Nenhuma operação destrutiva em R2 de produção foi autorizada.


### TypeScript hardening follow-up (2026-11-04; PR branch, not a release)

- All **production** modules in `apps/api/src/` use `.ts`; tests (`apps/api/test/*.js`) and maintenance scripts (`apps/api/scripts/*.mjs`) intentionally stay as JavaScript. NodeNext `.js` import specifiers inside TypeScript refer to compiled output and must not be renamed blindly.
- `scripts/check-typescript-policy.mjs` recursively forbids JavaScript production source under API/web `src/` and `packages/shared/`, requires `strict:true` and `allowJs:false`, and rejects suppression directives. The frontend typing follow-up removes both temporary `@ts-nocheck` exemptions. All future exceptions require an explicit architecture decision rather than silently weakening checks.
- Keep branch/CI checks required for merge (branch-protection settings must be verified through authorized GitHub administration). Check behavior after removing exemptions, especially navigation, audio player, uploads and identity refresh. No merge or deployment is implied by this documentation change.


### Contract-oriented frontend typing review (draft Lot B)

- `AccountUserV2` belongs to shared contracts and network identity JSON is validated by `isAccountUserV2` before state is updated. The API remains the sole authority for sessions, access and media.
- Workspace navigation uses known route targets. A dead edit-profile action in the normal workspace header is removed because that header never renders on profile routes; the actual profile toolbar remains unchanged.
- Upload file IDs are numbers, beat/pack project IDs are UUID strings, and neither are converted across categories. Upload/R2, dedup, player, queue, pack visibility and playback flow are preserved.
- CI compilation cannot substitute for manual browser acceptance of navigation, account sessions and private media operations.


### Verified TypeScript audit criteria (draft Lot C)

- Negative policy tests cover nested JavaScript source under API, web and shared contracts, compiler strictness, block and line comment suppressions, and stale exceptions.
- The authenticated identity parser tests both minimal valid session objects and malformed user JSON; no client value replaces API ownership checks.
- CI at the final branch head is necessary but not sufficient for browser-level sign-in, Home, uploads, profile navigation and player acceptance. Keep the PRs in Draft until explicit merge and release approval.

### Permanent architecture-first acceptance criterion (1CE v2)

A green TypeScript build, a passing source-pattern test and a visually correct screen are **insufficient** to mark any feature complete.

1. **Domain ownership first:** identify the authoritative layer (web, API, database, R2) and the relevant behavioral contract in this guide before editing. Frontend state must not grant media access; all authorization belongs to the API. Saved, shared and published objects have distinct access semantics.
2. **Preserve media identity:** beats/packs refer to original files without extra R2 copies; owner and project UUID relationships must remain explicit; numeric file IDs must not be substituted for project IDs; streams, uploads, leases, deletion outbox and Trash must preserve ownership/integrity.
3. **Types must reflect runtime:** share canonical identity/project/media contracts, validate untrusted JSON at the boundary, avoid broad assertions and unchecked source. Do not leave unreachable branches solely to silence TS errors.
4. **Prove behavior beyond presentation:** CI and unit/type tests plus negative permission cases, isolated PostgreSQL/R2 checks where applicable, and approved browser acceptance for authentication, player and queue continuity, project visibility, shares, uploads and Trash. Pattern tests alone prove only the specific source invariant.
5. **Separate release statuses:** implemented, validated in CI, browser-tested, merged, deployed and manually verified are different states. Follow the gated batch/rollback protocol and never claim user-media safety solely from a green CI run.

**Known debt beyond these PRs:** some existing frontend profile helpers still contain broad `any` types. These lots do not make every feature fully typed, and they do not establish full multi-account browser/R2 acceptance. Address such work in scoped, behavior-tested follow-ups, not unrelated refactors.


### Tarefa 1 — typed profiles and playback contracts (branch review; no deploy)

- Scope: remove remaining explicit frontend `any` in public profile, editor, avatar and public playback adapters; reuse the canonical `AccountUserV2` model.
- The public profile response is verified at the browser boundary and invalid identity data cannot establish a successful profile load. User-initiated profile mutations must return a confirmed account object before the editor signals success.
- The public playback manifest is validated as untrusted JSON, enforcing original project UUIDs, positive numeric audio-file IDs and matching ownership. Client-side validation never grants access: the API alone authorizes playback and byte streams. Public manifests deliberately omit stems from download metadata.
- No SQL, R2 object, media duplication, OAuth, permissions, route or visual design changes are authorized in this lot. The new pure validation helpers receive negative regression tests.
- CI typechecking/unit/source checks are necessary but not browser acceptance for two accounts, session refresh, player continuity or real R2 upload. Mark these statuses separately and request merge/deploy approval after review.


### Tarefa 2 — API DB types and compatibility adapters (draft, not deployed)

- The API models pack metadata separately from playable beat rows; a pack has no audio/stems file ID. Validate PostgreSQL media/project rows at the API boundary rather than forcing unrelated shapes with `as unknown as`.
- Remove the historic public playback signature adapter and narrow project kind at the route. Keep owner/grant/publication/saves SQL, R2 keys, bytes, HTTP paths and deduplication behavior unchanged.
- Reject malformed ready media metadata before streaming and reject corrupt/mismatched project rows instead of fabricating IDs. The private Library audio route passes the real typed HTTP request without casting.
- Unit tests cover corrupt DB rows and inherited owner/visitor/media rules; mocks do not replace PostgreSQL/R2 acceptance. This draft makes no SQL, R2, OAuth, route or storage changes and requires separate permission for merge and deploy.


### Tarefa 2 — upload metadata and private R2 stream boundaries (stacked draft)

- Check actual AWS SDK GetObject Body at runtime with `isR2ReadableBody` before private cover streaming or bounded media verification. Invalid or absent streams fail closed without a falsely successful response.
- PENDING upload rows are validated for the right owner's staging prefix, supported kind, SHA-256, file ID, nonempty content type and positive byte size **before** lease acquisition, verification or R2 commands. READY retries remain idempotent.
- JSON parsing only accepts top-level objects, not unchecked arrays/strings. No changes to SQL, R2 object lifecycle, deduplication, endpoint routes, Trash, authorization or deletion are intended.
- Operator reported manual navigation/functionality checks passing after PR #46 (2026-11-04). This does not prove cross-account permission negatives, R2 races or upload/delete integration; those require isolated acceptance.
- This stacked PR is not merged and does not authorize deployment. Continue separate scrutiny of auth and remaining assertion-style casts, especially OAuth payloads and non-user-facing DB rows.


### Tarefa 2 — auth boundary typing (third stacked draft, no release)

- Google token/userinfo JSON is decoded from `unknown`: nonempty access tokens, verified email flag, user subject/email and optional name/picture shapes must pass runtime checks before any account linking or session creation. No changes to OAuth state, cookies, PKCE, database commands or URL paths are intended.
- The profile-follows handler now uses the real request type through a generic callback contract; this removes a server-side forced cast while preserving anonymous GET, owner/other-account restrictions and PostgreSQL-only follows.
- Errors remain fail-closed; negative tests check malformed token and userinfo data. Existing OAuth flow, CI and mock Postgres regression suites remain mandatory. This is stacked above #47 and #48, not merged and not deployed.
- Deliberately retained noncritical Node callback-overload assertions and error-log narrowing are not external authorization shortcuts; address further changes only with scoped tests.


### Reported Profile/Saves player and duplicate-queue defects (2026-11-04, proposed fix)

- **Operator evidence:** Home audio plays, but Play from own and third-party profiles and Saves fails; Add to queue duplicates entries. Do not treat earlier navigation-only acceptance as a playback acceptance.
- One persistent Workspace-owned audio player serves Home, Catalog, Saves and authorized shared projects. The player dock, audio node and errors render outside the offscreen, collapsed Home container without spawning a second player. Playback state should persist across navigation and reset on account changes.
- Profile Play and Add to queue both call the existing server-authorized project manifest endpoint with the original project/owner identity, using the same runtime-validated parser. Do not derive audio-file ownership from the viewer, duplicate media or create new grants.
- The queue has one entry per `owner_id + beat UUID`; repeated Add to queue cannot append duplicates. The active track is shown in the Now playing area rather than repeated as Up next. Pack ordering, cover fallback and queue-origin state survive Next/Previous/selection.
- CI/unit tests verify cross-owner identities, manifest/cover/pack ordering, duplicates and integration source contracts. Manual browser acceptance is still required for own profile, foreign published profile, Saved projects, queue additions, browser audio policy and denial of unauthorized projects. Saves alone do not mint R2 media grants.
- Scope: frontend, tests, this guide only. No API/SQL/R2/permission changes, merge or deploy without approval.


### Production incident — Profile/Saves pack playback HTTP 500 (PostgreSQL BIGINT boundary)

- **Observed in Railway production HTTP/runtime logs:** `GET /api/public/play/:owner/pack/:uuid` repeatedly returned HTTP 500. The server recorded `Invalid database pack metadata`. Audio and cover endpoints in the same sessions returned 200. A previous frontend player PR passed CI but could not repair this backend failure.
- **Root cause:** `library_packs.cover_file_id`, `library_beats.audio_file_id`, `cover_file_id` and `stems_file_id` are PostgreSQL `BIGINT` columns. Node-postgres returns these as decimal strings by default; the Tarefa 2 decoder incorrectly accepted JavaScript numbers only. Earlier mocked unit tests used numeric IDs, hiding the production incompatibility.
- **Fix (API-only candidate):** decode positive decimal string IDs into safe integers, retain valid safe numeric IDs and null optional fields; reject malformed, fractional, leading-zero, negative or unsafe integer IDs. Keep strict project UUID, owner, publication/share/Save authorization and the original file references unchanged. No database schema/R2 changes.
- **Regression gate:** unit tests must cover actual pg-string-shaped beat/pack responses and unauthorized owners; the disposable PostgreSQL migration smoke calls the real `resolvePlayableProject` on inserted `BIGINT` columns and checks ordered tracks and denial to another account. Compilation alone does not establish real browser playback.
- **Release status:** branch/PR candidate only until explicit merge approval. After release, independently verify `/api/public/play` succeeds for the owner's pack and authorized visitor, and unauthorized projects remain 404. Never log R2 secrets, signed URLs, private media or raw auth tokens.


### Profile card left-click — original project detail regression (PR candidate, 2026-11-04)

- Operator reports: Home cards open, Profile Catalog/Saves cards do not; their right-click menus and play buttons work. Root cause is frontend: shared `ProjectCardV2` receives `onOpen` in Home but not in Profile. It is **not** evidence of duplicated projects or R2 media.
- Catalog and Saves are authorized **read projections of the original** `library_beats`/`library_packs` UUID and owner ID. `v2_public_projects`, `v2_public_saves`, and grants contain relationships; never clone beats, packs, covers, audio, stems or project metadata into another storage object.
- The Workspace forwards the original `owner_id + kind + UUID` from any Profile card into the **already mounted Home detail renderer**. The existing pack detail JSX is shared for Home inline and Profile overlay, and the existing beat modal is portaled outside the hidden Home container. **No second detail implementation or audio player.**
- The Profile path obtains detail metadata only from the existing `/api/public/play/:owner/:kind/:uuid` endpoint, using validated server-authorized manifest, correct cover owner and member order. The backend remains solely authoritative for permissions. Nonowners may not acquire owner-only edit/delete rights by opening project details.
- Close/Back returns to the same Profile, including Saves. Profile identity changes or account changes close stale details and abort pending requests, without interrupting authorized ongoing audio.
- Cover click or keyboard Enter/Space opens detail; Play remains a separate action; right-click menu remains unchanged. Regression tests protect shared ID, original media references and same UI renderer. CI cannot substitute authenticated two-account browser acceptance.
- This proposed fix modifies frontend/tests/docs only. No SQL, API, R2, permissions, uploads, copy, new media route or merge/deploy without explicit release authorization.


### Settings reference layout and consistent workspace top chrome (same proposed PR #52)

- **Reference:** user's first screenshot supplies relative column width, alignment, rounded card groupings and discreet top controls. The current 1CE screenshot is the before-state. Apply the composition, not a clone of another service's subscription, referral, payment or marketing features.
- Settings desktop column widths are **230px / 308px** with a **58px gap**, centered beneath the shared workspace header; the left account card has a larger avatar and clear username/edit link; the right side groups the existing functional Profile, Trash, Terms, Privacy and Logout actions. Responsive layout collapses to one column with the same real actions.
- The UI must **not invent join dates, subscription state, memberships, purchases, referrals or billing counters** absent from the authoritative account model. The avatar fallback is visual only; avatar edit, username save and trash confirmation remain unchanged.
- Every authenticated workspace view—Home, World, Upload, Settings and public/own Profile—uses the same anchored 1CE logo and consistent subdued rounded icon controls. Subviews include an actionable back control; the Profile keeps its own Back, Follow, Copy and Edit actions. Preserve the persistent player and existing nav-menu semantics; do not turn a real option into an inert icon merely to imitate the reference.
- Changes are purely layout/interaction and retain existing auth, API, asset ownership and authorization. The profile-card opening fix in this PR remains separate from the visual treatment; both require build/regression checks and browser review before merge or production deployment.


### PR #53 — restore Home menu and align lower player to v1 reference

- Home again uses the same `CompactWorkspaceNav` and dropdown as World/Upload/Settings. Do not replace the Home menu trigger with a direct Settings shortcut; retain Home, World, Upload and Settings as real navigation destinations.
- Player screenshot comparison (reference vs 1CE): the **reference waveform is shorter** and the transport/option buttons are **more evenly spaced**. Preserve the reference capsule maximum width of 860px, but bound the waveform to a roughly 150–190px desktop column and give the seven controls adequate hit areas instead of squeezing them together.
- Keep the established order: Previous, Play/Pause, Next, Shuffle, Repeat, Playback queue, Volume. Group the first three transport actions separately from the last four utility actions in the single persistent player; do not create a second player or modify any callback.
- At <=760px retain the v1-inspired three-row mobile layout with waveform stretching across its own row; a compact intermediate breakpoint avoids overflow on narrower laptops. The purple vertical Volume popup must still open upwards.
- Eliminate duplicate `.onece-player-dock` and `.onece-global-player` declarations in `workspace-v1.css`; `library-items-v2.css` is the single player stylesheet. Audio decoding, seek, volume, order, queue identity, access permissions, R2, SQL, API and navigation routes remain unchanged.
- This is a **visual/layout correction** with source-contract tests; CI and builds do not replace browser acceptance of desktop, laptop, and mobile spacing/seek/volume. No merge or deploy without explicit authorization.


### Contextual Back arrow (2026-11-05)

- The 1CE logo is the permanent Home shortcut. A top-left Back arrow adds no value when the route entry was reached directly from Home: hide it on World, Upload, Settings, and Profile in that case, while preserving the same logo position.
- Internal navigation records the origin pathname in the browser history entry (`oneceFromPath`, via React Router state). For routes entered from other pages, retain the Back arrow and return to the preceding entry. Direct links/reloads without a known origin keep a fallback Back control to Home.
- Public and own Profile use their existing shared navbar and Back callback; hiding the button does not modify Follow, Copy, Edit, user identity, player state, account access, project IDs, or authorization.
- This UI-only change has no SQL, R2, media, uploads, or API changes. Requires CI and browser verification of Home → Settings/Profile/World and World → Profile/Settings, including browser Back/Forward and reloads. No merge/deploy without approval.


### 2026-11-05 — logo-only header on World, Upload, Settings

- On World (`discover`), Upload, and Settings (`account`), **always render only the clickable 1CE logo at the top-left**, regardless of prior navigation route, direct deep link or reload; remove the redundant Back arrow for these three workspace views. The logo continues navigating to Home.
- Preserve the header's right-side Profile and shared navigation buttons, including hover, keyboard, click and mobile behavior; preserve existing logo geometry and the persistent player.
- Home already uses logo-only on the left; Profile has its own header and retains contextual Back behavior from PR #54; the independent `edit-profile` placeholder route may retain contextual Back when applicable.
- Keep the `oneceFromPath` origin tracking for contextual Profile behavior and browser history; only change the left workspace header arrow visibility. No API, R2, database, auth, upload or playback changes.
- This is a UI-only regression fix. Confirm builds and tests before merge, then verify actual Vercel deployment and browser navigation.


### Profile visual hierarchy and shared Home card wrapping (2026-11-05)

- Visual reference supplied: profile photo and username should appear lower beneath the fixed header, with Catalog/Saves/Following tabs slightly wider, taller, and larger in icon size. The visual proportions apply equally to own and third-party profiles.
- Desktop profile top: 120px avatar, top padding 58px, section min-height 330px; tabs width up to 560px, 56px hit height, 20px icons. Mobile keeps centered identity with 108px avatar and a smaller vertical offset. Content below tabs has 38px top padding.
- Catalog and Saves must follow **the Home grid geometry**, not a separate fixed 6/4/3-column grid: flex-wrap, center alignment, fixed 160px card width, 32px desktop gap and 960px maximum content width. At <=600px the same Home breakpoints apply: 20px vertical / 14px horizontal gap, up to two fluid cards per row with 160px maximum width. Short lists naturally center with the same gaps as Home. Remove the profile-specific is-compact branch.
- ProjectCardV2 remains the single semantic card for both contexts with original kind/owner/UUID; covers, project opening, playback, Save, context menus, access rules and player instance do not change. Following remains an independent narrow list and the Profile navbar is not changed.
- Scope frontend visual styles and regression tests only. No migrations, API, auth, R2, player behavior, or deployment without separate authorization. Validate desktop/mobile browser views after builds.


### Proposed owner downloads and Upload/Download Stems — separate batch after PR #56

- The v2 visual Profile changes from PR #56 were published first and validated by Vercel (commit be45c5f, production READY). The features in this section belong to a separate review PR; do not deploy them alongside the visual update before validation.
- Existing, private R2 `library_files` assets remain **one reference per original file**. No downloads create new files, no beat is duplicated when it appears in Home, Catalog, Saves or packs. Pack membership comes from `library_pack_beats.position`.
- Owner beat context menu: **Download MP3** (original MP3, or WAV when the original was WAV; no conversion). Owner pack context menu: **Download** (browser-created ZIP with one top-level folder, ordered original audio files and each member's attached stems ZIP under `stems/`). File titles are sanitized, numbered to avoid collisions, and limited to 750 MiB for browser memory/ZIP32 safety. Larger packs must download tracks individually until a streaming archive is implemented.
- Nonowner profile menu preserves its existing **Download MP3** and pack track picker. Third parties cannot access stems just because an item is public, shared or saved.
- **Upload/Download Stems** (owner beats only) uses exactly the already-verified private R2 init/PUT/complete pipeline with SHA-256 and the existing 250 MB ZIP cap. Attachment/detachment is `PATCH /api/library/projects/beat/:id {stemsFileId}`, inside the existing owner-advisory-lock transaction; only READY stems owned by the same account may be linked. Detaching only changes a reference; the R2 file is not prematurely deleted.
- **GET /api/library/files/beat/:id** returns the original owner beat's relevant file IDs; **GET /api/library/files/stems/:id** requires current authentication and the original owner and streams verified ZIP with Range support. Never serve presigned URLs to readers or expose bucket keys in public read-models.
- Download ZIP is a client-side ZIP32/STORE writer with standard CRC32, UTF-8 filenames and central directory; it uses existing authorized endpoints, no archive persisted on R2 and no new third-party package. Failure must remain visible; no false-success toasts. Browser-memory and per-file byte caps apply.
- Regression focus: unauthorized owner-vs-other account behavior, confirmed READY stems, no cross-user linking, no ZIP/asset duplication, pack order, correct ZIP folder layout, unchanged player and third-party permissions. Full production use needs smoke tests with real authenticated R2 objects, including a pack with stems; CI alone is not proof of live byte integrity.
- New feature PR remains unmerged/unpublished until CI and explicit approval. Client/server releases must be coordinated because new UI calls new API routes.


#### PR #57 — pre-release evidence and isolated R2 procedure

- The CI web tests now generate genuine PCM WAV files and a nested stems ZIP, assemble a pack via the production ZIP writer, open both archives with an independent `unzip` reader, and compare SHA-256 against the original audio/stems bytes. This is **not** a cloud R2 or browser authorization test.
- Optional real R2 probe: `node --experimental-strip-types apps/api/scripts/pr57-r2-zip-stems-smoke.mjs` from repo root, after `pnpm install --frozen-lockfile`. It requires the four `R2_SMOKE_ACCOUNT_ID`, `R2_SMOKE_KEY_ID`, `R2_SMOKE_SECRET`, `R2_SMOKE_BUCKET` environment variables and a dedicated `onece-s2-smoke-*` bucket. It rejects the configured production bucket, generates unique keys, removes those test objects, and does not modify the app database or any real project.
- The R2 probe writes two genuine WAVs and a valid stems ZIP via presigned PUT; checks HEAD, immutable conditional copy, R2 GET, byte-range read and SHA-256; then builds and parses the ZIP pack locally from the retrieved R2 bytes, checks nested stems, folder order, CRC32 and SHA-256, and checks unsigned S3 API access is denied. CI only syntax-checks this opt-in probe; no secret is used by the CI job.
- Remaining **release blockers** after that script passes: exercise a non-production deployment with authenticated owner and second account, real user MP3/WAV and stems ZIP; confirm stems upload/replace/detach persistence in DB, ZIP extraction, authorization 401/404 for foreign asset IDs, no public stems disclosure, error handling for oversized archives, and unchanged playback. This requires an API + frontend candidate running together; do not treat the storage-only probe as that end-to-end approval.
- Never merge or deploy PR #57 based solely on a green CI or the R2 storage-only test. Coordinate API and frontend release after final user approval.

#### PR #57 — real R2 PASS recorded (2026-11-05)

- User executed `node --experimental-strip-types apps/api/scripts/pr57-r2-zip-stems-smoke.mjs` with their dedicated, isolated R2 smoke credentials and reported `PR57 REAL R2 SMOKE PASS`. Observed PASS output explicitly confirmed 3 signed PUTs; HEAD and conditional copy; GET/Range; SHA-256; nested stems ZIP extraction; ordered pack ZIP; CRC32; original WAV bytes; unauthenticated S3 endpoint denied. Credential values were **not** shared in chat. Treat as **isolated Cloudflare R2 object/ZIP verification**, not a browser or production media test.
- A previous 403 `SignatureDoesNotMatch` was resolved by checking/re-entering the dedicated credentials; the smoke now runs sequential uploads and omits cleanup for rejected PUTs. Never copy these credentials to frontend or GitHub Actions.
- Additional disposable PostgreSQL CI coverage added for PR #57: real DB attach -> replace -> unlink stems references on the canonical beat; verify owner/private status, foreign/anonymous 401/404, READY-only and own-user restrictions, pack independence, and retention of original `library_files` rows. This provides database-level test evidence, but it is **not** a substitute for authenticated browser E2E.
- **Still pending before deployment:** run the candidate frontend and compiled API together in an isolated nonproduction environment with test accounts and test objects, confirm upload/replacement/removal/re-download and persistence after refresh, reject access by second account, download real original WAV/MP3 and pack ZIP from the UI, verify missing/oversized error states and playback unaffected. Production publishing and merge require separate explicit authorization.


### Profile reference geometry fine-tuning (2026-11-05; post-PR #57)

- The user compared two 844px-wide side-by-side screenshots: 1CE v2 on the left and the desired reference on the right. The public-profile avatar is visually slightly too high, and the Catalog/Saves/Following underline/icons are approximately 30px too low. The profile's fixed logo/actions also sit higher and closer to the outer edges than the reference.
- Desktop-only profile adjustments in `public-profile-v2.css`: top section from `min-height:330px; padding:58px 0 46px` to `min-height:294px; padding:68px 0 5px`. This nudges the avatar down ~10 CSS px while lifting the tabs ~30–35 CSS px by shortening empty space **below** profile identity; do not move avatar and tabs together.
- Desktop fixed header (Profile page **only**, viewport >=681px): respect safe-area insets with `max(80px,env(safe-area-inset-* ))` horizontal gutters; lower logo/back and actions with `translateY(18px)`, and tighten icon-action gap to `8px`. The shared HeaderV2 CSS, mobile <=680px header, button behavior, follow/copy/edit/back actions and other workspace pages stay unchanged. Do not recreate global header overrides.
- This is visual-only CSS and regression assertions. Preserve shared Home grid/card spacing, public visibility and saves, player and waveform, navigation, auth, API/R2 and stems behavior. Run Node 22/26 frontend builds and tests, review CI and Vercel preview before any explicitly approved merge/deployment.


### Shared workspace header geometry and Settings shortcut (2026-11-05)

- The approved desktop Profile header geometry (PR #58: 80px safe-area-aware edge gutters, logo/actions lowered by `translateY(18px)`, 8px horizontal gap between action controls) is now **owned by the shared HeaderV2 stylesheet** in `apps/web/src/workspace-v1.tsx` for viewport widths >=681px. All workspace pages—Home, World, Upload, Settings, Profile and edit view—use the same header position. Duplicate Profile-only geometry was removed from `public-profile-v2.css`. The <=600px mobile breakpoint and intermediate narrow widths remain untouched.
- On the Settings route (`view==='account'`) only, omit the header `library-profile-trigger` button that navigates to Profile. Keep the clickable 1CE logo, compact Home/World/Upload/Settings nav, and Settings page's own profile-management card/link unchanged. On Home, World and Upload, retain the profile trigger and existing navigation.
- This batch is frontend-only; no change to auth, API/R2, database, stems/downloads, playback, queue, waveform or project grid. Check regression tests and Vercel preview before merging to avoid unnecessary production deployments.


### Global project-card/player scale and final profile tab alignment (2026-11-05)

- Based on a side-by-side screenshot of 1CE (left) and reference (right), at comparable scale the current 160px square project cards appear ~130px wide versus ~173px in the reference. Increase **both** Home and Profile/Catalog/Saves shared `ProjectCardV2` layout widths from 160 to **216 CSS pixels**; retain the 32px desktop wrap gap, centered max-960px collection, shared play/open/context behavior and responsive two-card layout using `min(216px, calc(...))` under 600px. The `library-page` narrow-screen override must match so card widths cannot diverge by selector order.
- Profile tabs alone: widen desktop Catalog/Saves/Following bar from 560px to 620px, raise it 20px relative to the unchanged avatar/username via negative margin, increase tab icons from 20px to 24px. Increase the project panel top padding from 38px to 70px to preserve/add appropriate separation between tabs and cards; on <=680px cancel the negative tab margin and keep mobile panel spacing. Do not move the avatar/header, which were already approved.
- One **shared** global audio player (portal from LibraryItemsV2) appears on Home and across profile navigation: raise dock by 8px (bottom inset from 24px to 32px, maintaining safe-area max). Match reference vertical volume tower silhouette with the longer graphite capsule extending behind the **existing single** speaker icon, retaining the 1CE purple slider, input range behavior, accessible labels, and playback logic. Maintain existing queue/shuffle/repeat controls, waveform geometry and dock-responsive breakpoints.
- Entire batch is CSS and regression-test only; no file storage, API, migrations, account access, uploads/downloads, WAV/MP3 conversion or player state changes. Validate builds/test CI and browser preview before a user-authorized merge.


### Profile links and shared volume tower spacing (2026-11-05, follow-up to PR #60)

- The user compared the 1CE profile and player against the reference and identified two residual layout issues. **Profile only:** the link icon row nearly overlaps the newly raised Catalog/Saves/Following tabs. Decrease the compact social links' top margin from 20px to 8px, making link icons sit more evenly between the username and the tabs. Preserve profile top's 294px minimum height, avatar, header, tab-bar position and mobile rules; the link row moves independently.
- **One shared bottom player for Home and Profile:** the graphite volume capsule extends too far below the speaker, while the purple slider track stops early with dead space above that speaker. Keep capsule top approximately fixed while lengthening the vertical track (track 106 -> 126px; input 100 -> 120px), reducing unused bottom padding (73 -> 45px), and moving the capsule bottom from -13px to -6px relative to its existing anchor. This brings the bar closer to the **single existing speaker button** and raises the capsule's lower edge. Do not duplicate the speaker or change volume state, slider input logic, waveform, transport, queue, or playback.
- Scope to existing CSS and CSS-contract regressions; no API, database, R2, permissions, card changes, playback actions or migrations. Require green CI and browser preview before any approved production merge.
