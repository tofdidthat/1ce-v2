# 1CE v2 PR #28 — Trash / R2 permanent deletion release gates

## Complete isolated restore rehearsal — 2026-11-03

**PASS — full restore of a previously verified private R2 backup to disposable PostgreSQL.** One-shot Railway service `1ce-v2-private-restore-rehearsal-once` used the `postgres:18-alpine` image, downloaded only `db-backups/1ce-v2/20261103T215852Z/postgres-custom.dump` from the private v2 R2 bucket, verified its archived SHA-256 `83dcaa6dc51e580fb4e54d21741b0d24ae488da590f15740b177eb4ead07e0fb`, initialized a PostgreSQL 18 cluster inside the disposable container (local Unix socket only, no TCP listener, no persistent volume, **no production DB credentials**), and completed `pg_restore --no-owner --no-acl --exit-on-error --single-transaction` into its temporary database.

The restore then verified the required v2 tables and migration 012 trash schema in the restored database and counted **18 public tables, 2 users, 11 beats, 1 pack, 23 library files, 0 queued R2 deletes, and 24 foreign-key constraints**. Runtime logs on deployment `1670bf99-b544-49a5-a167-cfd8f5807e3d` ended with `RESTORE_CHECK schema_012_and_required_tables_valid` and **`RESTORE_FULL_SUCCESS`**. Earlier attempts uncovered and fixed two test-harness problems (missing `su-exec` image utility and ownership of the locally downloaded archive); no production data/schema change was attempted. On success the temporary service was deleted. Post-cleanup inventory shows only the original Postgres and 1ce-v2 services (both SUCCESS) and no pending Railway changes. This closes the full restore rehearsal gate; it does **not** authorize PR28 merge, application deploy, or R2 deletion.

**Remaining:** independent deletion/concurrency safety review, controlled disposable-media R2 canary, final-HEAD CI and explicit coordinated release approval.


## Verified v2 production database backup — 2026-11-03

**COMPLETED (archive + remote integrity):** An isolated, ephemeral Railway one-shot service `1ce-v2-private-db-backup-once` ran `pg_dump --format=custom --no-owner --no-acl` against **v2 production PostgreSQL only** in Railway project `courteous-spontaneity`. It uploaded the archive to the private R2 bucket under `db-backups/1ce-v2/20261103T215852Z/postgres-custom.dump` (57,413 bytes, SHA-256 `83dcaa6dc51e580fb4e54d21741b0d24ae488da590f15740b177eb4ead07e0fb`). Deployment `ab27fb87-4e14-467d-8bbe-bd6dedbcdedc` logs confirmed:

```text
BACKUP_PHASE pg_dump
BACKUP_PHASE upload_to_private_R2
BACKUP_PHASE verify_remote_integrity
BACKUP_VERIFIED_KEY db-backups/1ce-v2/20261103T215852Z/postgres-custom.dump
BACKUP_VERIFIED_SIZE_BYTES 57413
BACKUP_VERIFIED_SHA256 83dcaa6dc51e580fb4e54d21741b0d24ae488da590f15740b177eb4ead07e0fb
BACKUP_ARCHIVE_SUCCESS
```

The one-shot job **downloaded the archive back from R2, compared it byte-for-byte** with the original dump and verified that `pg_restore --list` can read the remote copy's archive structure. The temporary service was then deleted. Final Railway inventory showed only the original `Postgres` and `1ce-v2` services, both with `SUCCESS` deployments and no staged changes; the original PostgreSQL volume remained attached, and neither the main branch nor API/frontend was redeployed.

**Boundary:** A complete `pg_restore` into a separate disposable PostgreSQL instance has **not** been run during this backup. Archive integrity is verified, but full restore-readiness is not independently established. Before an irreversible R2 purge release, complete independent R2 safety review, controlled canary and any additional recovery rehearsal required by the release owner. **No PR #28 merge, app deploy or permanent R2 delete was performed.**


Branch: `feature/v2-trash-r2-safe-purge`. No main merge or deploy until separately authorized.

1. Back up and verify v2 production PostgreSQL; preserve v1.
2. Verify migration 012 in disposable PostgreSQL, including idempotence, reference-protected DELETE and transactional outbox creation. No destructive migration in production.
3. Apply 012 **to v2 production only** in a separately approved maintenance step, before deploying branch code.
4. Verify API test suite and web build on last branch HEAD; perform independent DB/R2 safety review.
5. With explicit release approval, deploy API and frontend together, test owner's Settings → Trash above Terms; Delete → move to Trash → restore; Trash → Empty Trash with text confirmation and R2 deletion.
6. Test: beat still referenced by a live pack, two beats sharing cover, detached beat, staged/pending upload, public/saved project, session ownership, simultaneous writes, R2 DeleteObject 5xx and retry, storage quota, and music player.
7. Check pending jobs and failure rate. If jobs are pending, report partial completion and retry; do not claim R2 deletion occurred.
8. Rollback code if functional regression. A prior hard purge of R2 objects is irreversible even after rolling back code or DB schema. Never run destructive R2 cleanup against v1 or unverified keys.

**Intentional limitation:** Recovery is offered only for 30 days; the app does not schedule expiry-driven purge automatically. Empty Trash deletes selected trashed projects only when the owner explicitly confirms. R2 jobs left from a transient failure are idempotent and retriable by Empty Trash. Unattached READY files outside purged project references are retained, not swept globally; separate audit handles historical orphans.

**Protective invariant:** A verified R2 key must not be deleted while its `library_files` record is still referenced by any beat or pack. FK-restricted metadata retirement and durable outbox must succeed in one transaction before R2 DELETE is attempted.

## Continuation after interrupted Work — 2026-11-03

- Verified PR #28 remains a draft; the previous HEAD `b38670a` passed GitHub workflow `V2 API and frontend checks` (run 41713089166). This does not replace final-HEAD CI or external integration testing.
- Added `history/database/012_trash_and_r2_delete_outbox_safe_psql.sql`, a guarded **psql** script recovered from the 1CE migration work. It verifies S2 schema markers, uses a transaction with a 5-second lock timeout, validates columns/indexes/outbox, and reports six verification booleans. **The script has not been executed against production.** The `\\set` and `\\echo` directives mean run it using **psql**, not a generic SQL-only dashboard.
- Railway inspection identified v2 project `courteous-spontaneity`, production Postgres and `1ce-v2` API service sourced from `tofdidthat/1ce-v2:main`; the legacy `content-empathy` project with `1ce-server` must remain untouched. No public PostgreSQL TCP proxy was found for v2. Do not expose a database merely to run this migration.
- **PENDING:** verify a recoverable backup, arrange an authorized secure DB execution path, apply the guarded 012 against **v2 only**, record six true results, confirm rollback/retry plan, then rerun final-HEAD CI and isolated DB/R2 integration safety tests. PR remains draft; do not merge or deploy without a fresh go/no-go decision.
- **Concurrency audit to complete:** publishing, saving, sharing and beat/pack creation are separate transactions and do not consistently take the per-account Trash advisory lock. Verify races against moving projects to Trash; guard against stale relations after deletion. Also test UI behavior when a beat is hidden in a trashed pack, and when shared covers remain live. Do not treat static tests alone as proof of these invariants.

## Pack-only beat deletion rule and release preparation (2026-11-03)

The owner clarified that beats existing **only inside a pack** must go to Trash together with the pack. The implemented behavior is:

- On pack delete, auto-trash member beats with `library_visible=false` and no other active pack membership, stamped with the parent pack's exact `deleted_at` in the same owner transaction. Do not trash visible standalone beats or members referenced by other active packs.
- Revoke publication/save/share relationships for auto-trashed members and the parent. Show the parent as a single Trash item; children automatically trashed with it are not separately listed.
- On restoring a pack within 30 days, restore only member beats auto-trashed as part of some now-trashed parent pack, identified by the matching `deleted_at`. Manually deleted beats remain trashed. Handles a member originally present in multiple packs whose last active pack was later deleted.
- On explicit Empty Trash, purge the pack and its exclusive trashed members; retire and queue verified R2 objects only after confirming no remaining beat/pack FK references. No extra SQL migration was required beyond the already-applied 012.

**Concurrency hardening:** per-owner advisory transactions now guard project writes, beat/pack creation, publication, saves and share grants as well as Trash. Cross-owner saves lock the **original owner** and recheck project state before insertion. Isolated PostgreSQL smoke tests cover exclusive member cascades, shared files, manual deletes, restore, R2 outbox safety and 012 idempotence. API unit tests and web builds passed in [CI run #41722000497](https://github.com/tofdidthat/1ce-v2/actions/runs/41722000497) (6/6 jobs) at SHA `05a792a5`. Subsequent documentation change triggered a new CI check; verify the final HEAD.

**Release gate status:** v2 production migration 012 applied and verified; code + postgres tests validated. Do not merge/deploy until a current recoverable backup is independently confirmed (Railway connector does not expose volume backup status), the final HEAD CI passes, and a reviewer validates R2 deletion safety. The live canary should use uniquely named disposable files to exercise Trash, restore, and user-confirmed Empty Trash. Keep v1, existing customer media and production player untouched until the coordinated rollout is approved.

## Production database migration 012 — applied and verified (2026-11-03)

**DONE:** Migration `012_trash_and_r2_delete_outbox.sql` was applied to the isolated **v2 production PostgreSQL** in Railway project `courteous-spontaneity` (project `31168d29-2738-4a74-8a62-a13d2e2cc52c`, environment `55e9e0df-8408-4930-8722-63fa1d0d8942`). An ephemeral, private, one-shot Bun Function used an internal `Postgres.DATABASE_URL` reference, checked the v2/S2 schema markers, applied the additive DDL in a transaction with 5-second lock and 60-second statement timeouts, and performed post-commit read-only verification. Railway deploy logs for temporary deployment `8d29800d-0c9a-4ec2-8ec0-65ac8d75cd31` reported:

```text
MIGRATION_012_APPLIED
MIGRATION_012_VERIFY {"beat_trash_column":true,"pack_trash_column":true,"r2_delete_outbox":true,"beat_index":true,"pack_index":true,"r2_pending_index":true}
MIGRATION_012_SUCCESS
```

The one-off executor service `1ce-v2-migration-012-once` was **deleted after success**, with no volumes attached/detached. Follow-up inventory confirmed only the original `Postgres` and `1ce-v2` services, both at `SUCCESS`, no staged changes. **No application deployment or main merge occurred, no R2 object removal was invoked.** The PR remains draft, and the Trash API/UI is not yet live. Backups were not independently verified through the available connector; do not mark that release gate complete. Remaining gates: final-HEAD CI, isolated integration/R2 concurrency safety review, backup verification and user-approved coordinated application rollout before merge/deploy. Do not re-run 012 unless checking an unexpected schema discrepancy; it is additive/idempotent.
