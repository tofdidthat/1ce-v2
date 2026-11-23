# T061 — Reconciliação de recibos da Meta

O arquivo de recibos atende URLs já emitidas em `/privacy?deletion=<código>`. Ele contém somente
o SHA-256 do código e o instante de conclusão verificado, ou NULL quando pendente. A carga
não autoriza o desligamento, não altera vínculos e não conclui solicitações na Meta.

## Inventário e decisão antes da carga

- **V1:** pedir contagens por estado, idade do pendente mais antigo, códigos fora do formato,
  inconsistências estado/data e recibos sem vínculo. Pedir contagens de conexões Instagram
  e de identidades distintas em recibos e conexões. Usar papel de leitura sobre uma visão
  restrita ou relatório feito pelo operador. O exportador só precisa ler
  `confirmation_code`, `status` e `completed_at` de `meta_data_deletion_requests` e deve
  devolver apenas hash e conclusão. Nenhum token ou código bruto deve sair do banco.
- **V2:** pedir contagens de recibos por ação e presença de `legacy_response`, trabalhos de
  exclusão por estado e idade, conexões/tombstones e histórico de publicação Instagram sem
  mapeamento. Usar papel de leitura em visões agregadas ou relatório do operador. Para carga,
  usar papel temporário com CONNECT, TEMP, USAGE no schema e SELECT/INSERT/UPDATE somente no
  arquivo `v2_instagram_legacy_deletion_status`. Aplicar 024 com o papel normal de migrações.
- **Identidades:** nunca igualar IDs internos V1/V2. Um operador autorizado pode reconciliar
  sujeitos por identificador Meta exato no mesmo escopo do app, usando digests na comparação
  e retornando somente totais separados em correspondência única, sem correspondência e
  ambiguidade. Manter ambiguidades fora de qualquer carga de vínculos. Recibos independem de
  vincular uma identidade à V2.
- **Decisões do Ygor:** para dados exclusivos da integração V1, autorizar limpeza de escopo
  identificado com evidência ou manter o caminho legado ativo para resolver pendências.
  Para identidade ambígua, autorizar conciliação assistida com prova ou manter em revisão.
  Para pendentes, concluir no legado antes do corte ou aprovar um caminho substituto que
  preserve o estado e a capacidade de concluir. O arquivo só responde ao estado conhecido.
  Aprovar a janela e a retenção do arquivo temporário antes de qualquer extração real.

## Extração e carga

Executar somente em ambiente descartável até autorização específica. Congelar o conjunto
legado na janela de corte ou repetir uma extração final e reconciliar o delta. Usar uma
transação de leitura consistente para comparar quantidade exportada com o relatório de origem.
Estados diferentes de `pending` e `completed`, códigos inválidos ou estado incompatível com
a data vão para revisão em agregados. Se existirem exceções, não considerar o lote completo.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT status, count(*) AS total, count(*) FILTER (
 WHERE confirmation_code !~ '^[0-9a-f]{32}$' OR status NOT IN ('pending','completed')
 OR (status = 'completed') <> (completed_at IS NOT NULL)
) AS exceptions
FROM meta_data_deletion_requests GROUP BY status;
-- Exportar a projeção abaixo via COPY TO STDOUT, CSV HEADER, no cliente autorizado.
SELECT encode(sha256(convert_to(confirmation_code, 'UTF8')), 'hex') AS confirmation_hash,
 completed_at
FROM meta_data_deletion_requests
WHERE confirmation_code ~ '^[0-9a-f]{32}$'
 AND ((status = 'completed' AND completed_at IS NOT NULL)
   OR (status = 'pending' AND completed_at IS NULL))
ORDER BY 1;
COMMIT;
```

No destino com 024 aplicada, conferir ambiente, lote, contagens e hash do CSV antes de abrir
a sessão interativa do `psql`. Usar arquivo em área restrita. Mesmo um hash de código não é
dado para circular em chat. O exemplo usa o nome local `verified-receipts.csv`.

```sql
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE t061_meta_receipt_stage (
 confirmation_hash text NOT NULL CHECK (confirmation_hash ~ '^[0-9a-f]{64}$'),
 completed_at timestamptz
) ON COMMIT DROP;
\copy t061_meta_receipt_stage FROM 'verified-receipts.csv' WITH (FORMAT csv, HEADER MATCH)
\i history/database/t061_meta_receipt_load.sql
```

O exemplo deixa a transação aberta. Comparar `matched` com a contagem exportada e comparar
pendentes/concluídos com a origem, explicando cada `stale_pending` por conclusão já verificada.
No primeiro ensaio digitar `ROLLBACK;` e conferir que nenhuma linha foi adicionada. Só digitar
`COMMIT;` em carga autorizada e reconciliada. Em erro, executar `ROLLBACK;` e corrigir o
lote inteiro. Um lote comprovadamente vazio dispensa carga. Após commit, repetir a conferência
numa sessão nova e testar, com códigos fictícios em ambiente descartável, estados pendente,
concluído e desconhecido.

Reexecução mantém uma entrada por código, promove pendente para concluído e preserva
conclusão em replays antigos. Uma divergência entre duas datas de conclusão interrompe o lote.
Rollback operacional após commit mantém o arquivo para preservar URLs e desativa o modo
`INSTAGRAM_META_V2_ONLY` com V1 ainda disponível. Para reverter linhas carregadas, somente em
janela aprovada e com snapshot privado anterior dos hashes afetados e seus estados.
Conferir que o valor corrente ainda é o gravado pelo lote antes de remover novas linhas ou
restaurar as anteriores. Nunca restaurar sobre atualizações posteriores.

## Ensaio local e verificação de roteamento

Rodar da raiz do repositório. O PGlite executa o motor PostgreSQL em memória, sem URL de banco
e sem tráfego para serviços Meta ou Railway. A dependência do ensaio fica isolada.

```powershell
npm install --prefix node_modules/.t061-pglite --no-audit --no-fund --save-exact @electric-sql/pglite@0.6.0
pnpm --filter @1ce/api build
$t061Pglite = (Resolve-Path 'node_modules/.t061-pglite/node_modules/@electric-sql/pglite/dist/index.js').Path
node apps/api/scripts/t061-meta-receipt-smoke.mjs $t061Pglite
```

Antes do corte, repetir com PostgreSQL da versão de produção e com o cliente `psql` que fará
a carga. O ensaio local exercita SQL e handler, mas não o roteador da Vercel. Em implantação
descartável, com rewrites apontados para uma API descartável, testar `/privacy` normal,
`/privacy?deletion=<código>` com consulta preservada e sem parâmetro duplicado, e
`/api/instagram/data-deletion-status?code=<código>`. Testar 200 pendente/concluído, 404
desconhecido, cabeçalhos sem cache, ordem dos rewrites em relação à SPA e POST de callback
assinado exclusivamente com segredo fictício. Conferir que nenhum destino possa resolver
para produção no ensaio.
