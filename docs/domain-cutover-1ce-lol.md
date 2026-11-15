# 1CE — runbook de migração do domínio 1ce.lol (v1 → v2)

**Checkpoint somente leitura: 2026-11-15. Estado: PREPARAÇÃO; NO-GO.**  
Este documento é uma proposta executável somente após aprovação explícita de uma janela de mudança. Nenhum domínio, DNS, sessão, OAuth, banco, R2 ou variável de produção foi modificado por esta auditoria. O guia principal é `docs/architecture.md`. Não confundir CI verde e deploy READY com validação autenticada completa.

## 1. Inventário verificado

| Superfície | Estado em 2026-11-15 | Fonte / ressalva |
| --- | --- | --- |
| Domínio público | `1ce.lol` associado ao projeto Vercel **1ce** (v1), `prj_I9vbGamyz8ZAVTnowpuUc7Y9QsUr`; verificado | Vercel project domains + alias |
| Fallback da v1 | `autoshorts-nine.vercel.app` associado ao mesmo deployment READY da v1 | Vercel alias; verificar acesso funcional e autenticação antiga durante a janela |
| Frontend v2 | Projeto **1ce-v2**, `prj_3GYsUgeNUReJ498zzxjLdUULWObF`; `1ce-v2.vercel.app` e `1ce-v2-tofdidthat.vercel.app` verificados e no mesmo deployment READY da main `1703803` | Vercel project domains e alias |
| Escopo | Projetos v1 e v2 pertencem à **mesma equipe Vercel** | Vercel project details; não é transferência de registrador |
| DNS | Nameservers Cloudflare: `henrik.ns.cloudflare.com`, `millie.ns.cloudflare.com`. Vercel detecta `1ce.lol` com serviço DNS externo e `ipStatus=no-change` | Vercel get_domain_config; **não** comprova configuração/proxy/SSL/Page Rules dentro da Cloudflare |
| `www` | Não identificado como project domain; consulta de configuração de `www.1ce.lol` indicou `misconfigured=true` | Não inventar redirect nem criar DNS sem inventário/decisão |
| API v2 | Railway serviço `1ce-v2`: último deployment `94eee2e6…` SUCCESS (merge PR #93); sem mudanças staged. `WEB_ORIGIN`, `GOOGLE_*`, `DATABASE_URL` e `R2_*` presentes por nome | Railway describe_service/list_variables (valores ocultos pela conexão OAuth) |
| PostgreSQL v2 | Serviço Postgres SUCCESS, volume `postgres-volume` de 5.000 MB montado | Railway describe_environment; volume **não** é backup nem prova de restauração |
| Frontend env | Vercel tem `VITE_API_URL` nos ambientes production/preview/development | Vercel env metadata, sem expor URL configurada |
| CI | Main `1703803` (PR #94) GitHub Actions `43729772922` 7/7 success; main `2aa6c89` (PR #93) `43668125582` 7/7 success | Testes automáticos, não produção autenticada |
| YouTube e waveform | Usuário relatou upload real no YouTube bem-sucedido e waveform visivelmente mais rápida; PR #93 merged, PR #94 menu em perfil público merged | Evidência de usuário; **não** comprova OAuth pós-domínio, F5/duas contas ou falhas reais |
| Backups | Histórico em `docs/architecture.md`: dump 2026-11-03 verificado, restore isolado 2026-11-04 (`RESTORE_FULL_SUCCESS`) | Evidência histórica pontual: **backup atual, agendamento e nova restauração NÃO comprovados** |

### Dependências de autenticação confirmadas no código

- `apps/api/src/server.ts`: `WEB_ORIGIN` define **uma única** origem permitida pelo CORS, o destino `/app?login_code=...` após Google e o `Origin` aceito por chamadas sensíveis. `/auth/google/callback` usa `GOOGLE_REDIRECT_URI` do backend; não assumir que seja necessário mudar URI de callback se o host da API não mudar.
- `apps/web/src/login.tsx`: o `onece_v2_google_verifier` do PKCE está em `sessionStorage`, vinculado à **origem do navegador**. Iniciar no hostname antigo e concluir em `1ce.lol` pode falhar; iniciar/reiniciar o login na URL definitiva após a troca. Não redirecionar callbacks entre origens nem mover o verifier.
- `apps/api/src/publishing-secrets.ts` e `youtube-connection.ts`: YouTube utiliza `YOUTUBE_CLIENT_ID/SECRET/REDIRECT_URI` opcionais; sem eles, reutiliza o OAuth do Google da v2. A conexão do Railway **não lista** `YOUTUBE_REDIRECT_URI` nem `PUBLISH_TOKEN_KEY`; o código, portanto, tem fallback para `GOOGLE_REDIRECT_URI` e segredo OAuth ao derivar a chave de criptografia. **Não trocar/rotacionar `GOOGLE_CLIENT_SECRET` inadvertidamente**: isso pode inutilizar refresh tokens e sessões de upload criptografadas; nenhuma chave deve ser copiada para Git ou memória.
- `apps/api/src/publishing-api.ts`: POST de publicação exige `Origin` idêntico a `WEB_ORIGIN`; não há modo duplo para manter publicações válidas em `1ce-v2-tofdidthat.vercel.app` e `1ce.lol` simultaneamente no código atual.
- Cookies `onece_v2_session` da API são HttpOnly, Secure, SameSite=None. Sessões da **v1** não são importadas para a v2; uma troca de domínio não transfere usuários, biblioteca, mídia ou grants OAuth entre bancos/projetos.

## 2. Gates de GO/NO-GO antes de alterar qualquer serviço

| Gate | Evidência de aceitação | Situação |
| --- | --- | --- |
| G1 — inventário | Projeto de origem/destino, fallback v1, aliases, DNS e SSL conhecidos | **Parcial**: Vercel verificada; painel Cloudflare/SSL e `www` ainda não |
| G2 — OAuth e origem | Valor **exato**, verificado sem divulgá-lo publicamente, de `WEB_ORIGIN`, `GOOGLE_REDIRECT_URI`, cliente Google, `VITE_API_URL` e eventual YouTube redirect; cadastro correto no Google Cloud; teste de login, logout, token e canal | **Pendente**: variáveis existem, mas valores e console Google não estão legíveis nesta conexão |
| G3 — backup recuperável | Novo backup da PostgreSQL v2 com checksum e retenção em local privado, restauração integral em DB isolado, conferência de tabelas/contagens/refs e checklist de mídia R2 (sem copiar/retirar originais) | **Pendente**; histórico de 03–04/11 não basta |
| G4 — contas e permissões | Matriz owner/segunda conta/anônimo: project privado/público/despublicado, saved, compartilhamento, stream/Range, stems, menus, follow, revogação, F5 e player; erros não expõem mídia | **Pendente**; executar com ativos descartáveis |
| G5 — publicação real | Login com Google, conexão e desconexão YouTube, upload **privado** de teste autorizado, ID remoto, status/histórico, fechar guia e reler; sem duplicar se resultado for ambíguo | **Parcial**: envio normal confirmado pelo usuário; testes de queda/restart pós-cutover pendentes |
| G6 — prontidão release | Main CI 7/7, Vercel READY, Railway SUCCESS, `/health` e `/health/db` 200, origem inválida 403, anônimo 401; observar 5xx | **Parcial**: deploy e CI confirmados; health em HTTP real e matriz de erros não reproduzidos nesta auditoria |
| G7 — propriedade e continuidade | Confirmar contas/dados existentes apenas na v1, preservar export e acesso legado; caminho de rollback verificado e janela aprovada | **Pendente**; troca de domínio **não** migra dados da v1 |
| G8 — aprovação explícita | Proprietário autoriza corte e possível interrupção breve do login, com responsáveis online | **Pendente** |

**Decisão atual: NO-GO.** Resolver especialmente G2, G3, G4 e G7 antes de executar. Nada neste registro autoriza enviar dados privados à rede, esvaziar lixeira, modificar produção, rodar migrations ou testar exclusão em mídia real.

## 3. Sequência operacional (SOMENTE após GO)

1. Registrar commit e deployment READY de v1 e v2, IDs dos projetos, configurações de domínio, estado DNS/SSL, valor anterior de `WEB_ORIGIN` em um cofre privado (não aqui), presença de `VITE_API_URL`, URIs Google/YouTube e snapshots dos jobs ativos. Pausar novas publicações durante a janela por procedimento operacional revisado; **não** mudar o código de upload improvisadamente.
2. Verificar e documentar backup recente e **restauração isolada**. Confirmar acesso independente à v1 em `autoshorts-nine.vercel.app` e à v2 em seus domínios temporários. Não excluir a v1, banco ou bucket.
3. Preparar no Google Cloud apenas registros permitidos pelo fluxo real. Se o URI de callback da API continuar no mesmo host, preservar seu valor/cadastro; revisar origens autorizadas e o domínio da tela de consentimento. Não alterar segredos nem clientes OAuth por padrão.
4. Preparar `WEB_ORIGIN=https://1ce.lol` no Railway, sem ativá-lo antecipadamente. **A configuração atual é de origem única**: transição não atômica exigirá janela curta de incompatibilidade do login. Se disponibilidade zero for requisito, criar e validar antes um suporte de duas origens com PKCE/cookies/CORS corretamente escopados (mudança de código distinta), jamais uma troca improvisada.
5. Na janela autorizada, **reatribuir `1ce.lol` da v1 para o projeto `1ce-v2`**, usando o fluxo suportado pela Vercel sob a mesma equipe. A documentação da Vercel explica que remover de um projeto e adicionar no outro pode gerar indisponibilidade; nunca apagar a propriedade do domínio no nível da equipe nem usar force sem verificar o destino. Revalidar associação/SSL. Com base no diagnóstico `ipStatus=no-change`, não alterar nameservers/IPs por palpite; aplicar ajustes de DNS Cloudflare **somente** se a verificação do destino pedir, preservando outros registros.
6. Aplicar a configuração preparada `WEB_ORIGIN` no Railway de forma coordenada, observando deploy SUCCESS e `/health`/`/health/db`; conferir `VITE_API_URL` e CORS. Encerrar/reiniciar fluxos Google iniciados antes da troca, pois o PKCE foi salvo na origem antiga. Garantir que o domínio antigo da v1 não esteja servindo a v2 com sessão trocada por engano.
7. Smoke pós-cutover em `https://1ce.lol`: HTTPS/host/sem loop, abrir `/app`, Google login na **mesma origem**, F5, logout, segunda conta/anônimo, Library/pack/waveform/player, publicar vídeo **privado** de teste autorizado e conferir histórico/ID. Confirmar `1ce-v2.vercel.app` e alias de login ainda na produção esperada, mas **não** prometer login/publicação simultâneos nesses hosts com `WEB_ORIGIN` único.
8. Registrar resultados, tempos, responsáveis e links de logs/smokes sem cookies, tokens, URLs assinadas ou mídia. Só comunicar migração concluída após G1–G8 e testes pós-corte aprovados.

Fonte operacional Vercel: https://vercel.com/docs/domains/working-with-domains/transfer-your-domain ; https://vercel.com/docs/domains/set-up-custom-domain. Fonte OAuth Google: https://developers.google.com/identity/protocols/oauth2/web-server .

## 4. Rollback controlado (se falhar)

- **Acionadores**: login/callback quebrados, CORS de produção indevido, SSL inválido, perda de privacidade/autorização, falhas persistentes da API ou publicação sem idempotência. Não “resolver” desconectando contas ou excluindo objetos.
- Reassociar `1ce.lol` ao projeto Vercel v1 original sob a mesma equipe e confirmar que o alias padrão da v1 segue acessível.
- Restaurar o `WEB_ORIGIN` **anterior** do Railway e acompanhar health/deployment. Revalidar o hostname v2 original, login/PKCE e publicação; uma sessão iniciada em outra origem pode exigir novo login.
- Verificar rollback contra migrações aditivas: reverter frontend/API **não** desfaz automaticamente mudanças no PostgreSQL; nunca tentar reverter deletando mídia R2. Manter jobs em revisão quando acknowledgement remoto é ambíguo.
- Se dados foram modificados, seguir um processo de restore **separado**, aprovado e validado; rollback de domínio **não** restaura banco nem R2.
- Documentar incidente e manter o domínio na v1 até nova autorização.

## 5. Matriz compacta para o operador registrar evidências

| Caso | Resultado/evidência | Responsável | Data/hora | Estado |
| --- | --- | --- | --- | --- |
| Screenshots Vercel projetos + associação atual/esperada | — | — | — | Pendente |
| Cloudflare DNS `@`, proxy, TLS, redirects e `www` | — | — | — | Pendente |
| Google Cloud OAuth: callback exato + domínios autorizados | — | — | — | Pendente |
| Railway `WEB_ORIGIN` anterior/novo (somente em cofre privado) | — | — | — | Pendente |
| Backup NOVO, hash + restauração em DB isolado | — | — | — | Pendente |
| Inventário de usuários/links/dados exclusivos v1 | — | — | — | Pendente |
| Testes owner/segunda conta/anônimo + R2 | — | — | — | Pendente |
| YouTube privacidade, pós-cutover e idempotência | — | — | — | Pendente |
| Autorização do proprietário + janela + rollback | — | — | — | Pendente |
| Saúde pós-cutover, logs e aceitação | — | — | — | Pendente |


## 6. Backup/Restauração: tentativa e plano operacional (2026-11-15)

**Status: BLOQUEADO POR ACESSO, NÃO EXECUTADO.** O usuário autorizou a etapa de backup/restore, não o domínio. Auditoria read-only verificou via Railway conector:
- Projeto `courteous-spontaneity`, environment `production`, `Postgres` com deployment SUCCESS, volume `postgres-volume` (5.000 MB) montado e API v2 SUCCESS; zero alterações staged.
- Railway OAuth expõe nomes de variáveis, **não valores/credenciais PostgreSQL**. O serviço Postgres não possui TCP proxy público; este ambiente de execução não tem `railway`, `psql` ou `pg_dump` configurados e não tem rota autorizada ao banco.
- Tentativa de navegação Railway para Backups/Point-in-time recovery exigiu login e parou antes de acessar a seção. **Nenhum backup novo foi iniciado e nenhuma restauração foi efetuada**.
- O Railway conector disponível não disponibiliza ação de criação/listagem de volume backup/PITR ou de execução SQL; não criar proxy público, não instalar um serviço com DATABASE_URL de produção e não mudar credenciais como contorno.

### Operação segura a seguir no painel Railway autenticado

1. Abrir projeto `courteous-spontaneity` → ambiente `production` → serviço `Postgres` → aba `Backups`. Verificar se há backups de volume, o último ponto, frequência e retenção. Se houver opção **Create Backup**, criar um backup nomeado `pre-1ce-lol-cutover-2026-11-15` e registrar ID, timestamp, estado e tamanho **fora do Git**.
2. Verificar se o PITR está habilitado; **não habilitar/alterar retenção automaticamente** sem confirmar impacto, custos e procedimento de restauração. Se não houver funcionalidade de backup, usar um procedimento operador autenticado de `pg_dump -Fc` com túnel privado autorizado. Nunca copiar `DATABASE_URL`, segredo ou arquivo dump para o repositório.
3. Fazer **restauração para banco/volume/projeto descartável separado**, não no `Postgres` da produção. `Restore` no serviço atual pode sobrescrever dados ativos! Evitar qualquer botão de restore in-place.
4. No clone, validar existência e contagens das tabelas de usuários, sessões, media, packs, waveform, fila, publicações; integridade de FKs, consistência da versão de migrations e referências R2 **apenas por leitura**. Não executar workers de upload/delete no clone ou publicar mídia.
5. Registrar `backup_time`, `restore_time`, checksum (quando houver dump), banco de origem e clone descartável, resultado e duração, sem dados pessoais/segredos. Somente então marcar G3 aprovado. Não remover backup mais antigo antes de verificar o novo.

Fontes do Railway: `https://docs.railway.com/cli#postgresql`, `https://docs.railway.com/volumes/point-in-time-recovery`, `https://docs.railway.com/databases/troubleshooting/postgres-corrupted-wal`.


### Evidência direta do painel Railway (captura do usuário, 2026-11-15)

- A aba `courteous-spontaneity / production / Postgres / Backups` mostra **"No Backups — This service's volume does not have any backups"**.
- A mensagem do painel diz **"Upgrade to Pro to create new backups, set up automated schedules, or enable point-in-time recovery"**. Isso confirma a ausência de **backups gerenciados de volume nesse serviço**, não a ausência de TODO e qualquer dump lógico externo. O dump histórico de 03/11 não é ponto de restauração atual.
- Escolha operacional segura: ou plano Railway Pro para backup gerenciado, ou backup lógico privado por `pg_dump -Fc` e teste de `pg_restore` em banco **distinto**, sem upgrade. A migração permanece **NO-GO** até comprovar um backup novo recuperável e restauração isolada.
- A opção "Create Backup" **não está disponível no plano exibido**; a instrução condicional acima não deve ser interpretada como ação executável sem upgrade.
- Com Railway CLI autenticado no computador do operador, avaliar `railway connect postgres --tunnel-only` (documentação Railway, confirmar porta local exibida). Usar pg_dump 18 compatível com o servidor, credenciais obtidas em ambiente privado, e `pg_dump -Fc` sem colocar secrets no histórico. Registrar SHA-256 (por exemplo `Get-FileHash -Algorithm SHA256` no PowerShell), `pg_restore -l` e restauração **apenas em banco local descartável novo**. Comparar tabelas, contagens e integridade. Nenhum dos passos foi executado pela IA; depende de acesso autenticado do operador.
