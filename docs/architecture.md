# 1CE v2 — Architecture, operations and release guide

> **Canonical technical reference.** Last consolidated on 2026-11-04 UTC from `main` at `9f0bd2c89e49a3d332e11e805799c07710a47ace`. It describes repository source and dated operational evidence, **not** an automatic report of the live Railway/Vercel deployments. Recheck GitHub, Railway, Vercel and Cloudflare before making release or deletion decisions. Previous Markdown ledgers remain available via Git history and their pull requests; they are intentionally not kept as separate files.

## 1. Mission, boundaries and product decisions

- **v1 is strictly read-only.** Do not change the v1 repository `tofdidthat/1ce`, production site, database, bucket, tokens, OAuth clients, domains or sessions while working on v2. Migration of approved identity/user data requires a separate plan and authorization; never import v1 sessions or OAuth tokens.
- **v2 repositories:** frontend + API source in `tofdidthat/1ce-v2`; Vercel project `1ce-v2`, Railway project `courteous-spontaneity` and a separate v2 PostgreSQL database.
- **UI labels and design:** Home is the former Library, World is the former Discover. The app UI is English. Reuse existing components, iconography and CSS. Do not split beats and packs into redundant Library sections. The music player/queue, waveform and current playback must survive navigation and data refresh.
- **Original media, no copies:** packs reference their member beats; publication, saves and sharing create relationships rather than duplicate audio/cover/stems objects.
- **Storage plan:** the provisional technical default is **10 GiB per account** in the database plan model; this does not authorize paid tiers, pricing, billing or Stripe integration.
- **Files and operations:** prioritize safe, reversible batches, TypeScript in the frontend and explicit server-side ownership validation. The API is currently Node.js JavaScript; migrating it to TypeScript is an architectural option, **not** a completed step.

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
| API entry, auth/sessions/OAuth | `apps/api/src/server.js` |
| Private uploads and Library files | `apps/api/src/library-files.js`, `upload-security.js`, `upload-leases.js` |
| Project mutations | `apps/api/src/project-actions.js` |
| Trash, restoration and R2 outbox | `apps/api/src/trash.js` |
| Public profiles, saves, publications, links | `apps/api/src/public-profiles.js`, `profile-identity.js`, `profile-follows.js` |
| Access-controlled media and ranges | `apps/api/src/project-media.js`, `audio-stream.js` |
| Quotas and API rate limiting | `apps/api/src/storage-plans.js`, `api-rate-limits.js`, `login-admission.js` |
| SQL migrations and isolated smokes | `history/database/`, `apps/api/scripts/`, `apps/api/test/`, `apps/web/test/` |

The entry point `apps/api/src/server.js` delegates to feature handlers, which must perform authorization **again on the server**. File IDs and project IDs are not interchangeable; project identity should include owner, kind and project ID. Preserve existing HTTP routes until frontend consumers have migrated and been regression-tested.

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

**Começar pelas fases 1 e 2.** Configurar a execução compilada e os contratos pequenos antes de migrar módulos de arquivos/autenticação. Isso oferece ganhos de tipagem e ferramentas com o menor risco inicial; depois avançar isoladamente por componente crítico.

**Controle do andamento (2026-11-04 UTC):** Fase 1 iniciada na branch `chore/api-typescript-phase-1`, sem merge e sem deploy. Verificar o estado real da branch/CI antes de marcar Fase 1 concluída. A produção deve continuar usando o comando anterior até autorização separada.
