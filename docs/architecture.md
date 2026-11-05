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
| Library grid, beats/packs, player | `apps/web/src/library-items-v2.tsx`, `library-items-v2.css` |
| Project menu and actions | `apps/web/src/project-context-menu-v2.tsx`, `project-action-dialog-v2.tsx`, `project-requests-v2.ts` |
| Cover and project data | `apps/web/src/project-cover-v2.tsx`, `project-cover-cache-v2.ts`, `project-read-v2.ts` |
| Profile, follows, edit controls | `apps/web/src/public-profile-v2.tsx`, `edit-profile-panel-v2.tsx`, `profile-follows-v2.ts` |
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
