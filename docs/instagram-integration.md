# 1CE v2 — Instagram Business Login e publicação de Reels

**Estado operacional em 2026-11-16:** **OAuth conectado e publicação de Reels implementada/ativada na v2.** O proprietário publicou um Reel real em `1ce.lol` e o histórico marcou `Uploaded`. [PR #96](https://github.com/tofdidthat/1ce-v2/pull/96) criou a conexão; [#97](https://github.com/tofdidthat/1ce-v2/pull/97) diagnosticou OAuth; [#98](https://github.com/tofdidthat/1ce-v2/pull/98) adicionou a publicação; [#99](https://github.com/tofdidthat/1ce-v2/pull/99) detalhou falhas de rede/R2; [#100–#103](https://github.com/tofdidthat/1ce-v2/pulls?q=is%3Apr+is%3Amerged) refinaram Destinations e preview. A API/DB Railway e o domínio Vercel foram consultados e estavam online; credenciais permaneceram ocultas. **Este marco não prova App Review para todos os usuários, segurança operacional dos logs ou recuperação de falhas.**

> **Nota histórica:** em 2026-11-15, a R1 autorizava apenas a conta e `publishingEnabled` era `false`. Na versão atual isso **não descreve a produção**. Também **não existe mais checkbox extra** de aprovação pública: o usuário seleciona Instagram e clica no botão explícito **Publish public Instagram Reel** (ou **Publish to YouTube + public Instagram Reel**); o frontend só então envia `instagramPublicConsent:true` e o backend exige esse valor booleano. A opção YouTube `Private` é independente; **Instagram é público**.

## 1. Arquitetura vigente

| Componente | Comportamento atual / contrato |
| --- | --- |
| Meta developer app | Reutiliza **o app Instagram Business Login cadastrado na v1**, não o banco, sessões ou tokens dos usuários da v1. Suporta contas profissionais (Business/Creator). |
| OAuth | `POST /api/publishing/instagram/connect` → `GET /auth/instagram/start` → Instagram `oauth/authorize` → `GET /auth/instagram/callback`. State 256-bit, uso único e 10 min, cookie HttpOnly/Secure/SameSite=Lax, usuário da 1CE validado na volta. |
| Callback oficial | `https://1ce-v2-production.up.railway.app/auth/instagram/callback`; origem do frontend `https://1ce.lol`. Não alterar v1 sem inventário e plano de rollback. |
| Escopos | `instagram_business_basic`, `instagram_business_content_publish`. Instagram Login (não confundir com o App ID/Secret geral do Facebook). |
| Tokens | Token de longa duração criptografado por conta no PostgreSQL, geração de conexão usada para isolar jobs após reconexão/desconexão. O worker tenta refresh quando se aproxima do vencimento; se não for utilizável, exige reconexão. |
| Dados | Migration 018: `v2_instagram_oauth` e `v2_instagram_connections`. Migration 019: `v2_instagram_checkpoints`, `v2_instagram_media_grants` e campos do job para geração e aprovação pública. |
| API e fila | `POST /api/publishing/jobs` verifica o dono, arquivos READY, conexão de mesma geração e `instagramPublicConsent:true`. Destinos podem incluir YouTube e Instagram no mesmo job, com targets isolados. |
| Worker | Gera MP4 9:16 H.264/AAC 48 kHz a partir de áudio+capa, cria contêiner `REELS`, consulta processamento `FINISHED` e publica usando `media_publish`. Antes da chamada irreversível salva `publish_started_at`. Não retentar automaticamente publicação incerta. |
| Mídia | Originais ficam privados no R2. Meta recebe uma URL HTTPS de capacidade com token aleatório de 256 bits, hash no banco e validade máxima de 60 min; serve apenas o MP4 renderizado pelo endpoint `/api/publishing/meta-media?token=…`, com GET/HEAD/Range, em job running/autorizado. Quem possuir a URL durante a validade **pode ler o render temporário**. Nunca compartilhar ou registrar sua query string. |
| Feature flag | `INSTAGRAM_REELS_ENABLED=true` foi aplicado em produção na etapa operacional que permitiu o primeiro Reel, e a variável continua presente por nome em 2026-11-16. O código mantém default OFF se ela não estiver definida. Se houve alteração de valor depois, confirmar em variável privada do Railway, não inferir pelo nome. |
| UI | Destinations abre lista compacta; YouTube formatos 9:16/16:9 sob `⋯` à esquerda de Disconnect. Preview direito tem até 342.2 px; quando os dois formatos estão selecionados, 16:9 fica acima do 9:16 na mesma largura. TikTok/Telegram/Discord são previews não publicáveis; arquivo de vídeo original ainda não é suportado. |
| Estado/histórico | `GET /api/publishing/status` mostra jobs/targets; a UI usa `Uploaded` para `succeeded` e link direto apenas para YouTube. Link Instagram/permalink e estados mais claros estão no backlog, não implementados. |

**Serviços relevantes:** `apps/web/src/multi-platform-upload-v2.tsx`, `apps/web/src/upload-file-v2.ts`, `apps/web/src/publishing-api-v2.ts`, `apps/api/src/publishing-api.ts`, `apps/api/src/publishing-jobs.ts`, `apps/api/src/instagram-connection.ts`, `apps/api/src/instagram-reels-api.ts`, `apps/api/src/instagram-reels-worker.ts`, `apps/api/src/instagram-reel-media.ts`, `apps/api/src/publication-queue.ts`, `apps/api/src/publication-worker.ts`. O guia [architecture.md](architecture.md) é o inventário canônico de riscos e prioridades.

## 2. Configuração privada e herança da v1

O aplicativo da Meta vem do repositório v1 `tofdidthat/1ce` (fluxo antigo em `api/instagram/auth.js`, `api/instagram/callback.js`, `api/instagram/publish.js` e `lib/instagram-token.js`). Seu App ID/Secret foram reutilizados como **cadastro do provedor**, mas **não houve cópia** de contas, tokens de terceiros ou mídia da v1. A migração do domínio não transfere dados.

Configuração de produção no Railway, somente por painel seguro:

- `INSTAGRAM_CLIENT_ID` — ID do produto Instagram Login da Meta (`INSTAGRAM_APP_ID` é alias opcional de compatibilidade no código).
- `INSTAGRAM_CLIENT_SECRET` — segredo correspondente (`INSTAGRAM_APP_SECRET` como alias opcional). IDs/segredos conflitantes fazem a configuração falhar fechada.
- `INSTAGRAM_REDIRECT_URI=https://1ce-v2-production.up.railway.app/auth/instagram/callback`
- `WEB_ORIGIN=https://1ce.lol` — origem exata; não apontar a callback para o frontend.
- `INSTAGRAM_REELS_ENABLED=true` — gate explícito de publicação; desligar não apaga os jobs já gravados.
- `PUBLISH_TOKEN_KEY` pode existir; o fallback de criptografia usa segredo OAuth estabelecido. **Não introduzir ou rotacionar** essa chave ou os segredos Google/YouTube/Meta sem plano de migração dos ciphertexts e reconexões.

**Nunca** imprimir secrets, OAuth codes, refresh tokens, URLs assinadas ou `/meta-media?token=…` em Markdown, issue, print, query de observabilidade ou frontend. Os nomes das variáveis podem ser documentados; os valores não.

### CORS do R2 após o cutover

Houve falha `Failed to fetch` no PUT do browser para R2 após a mudança de hostname. A API recebia status mas não a publicação; a nova interface delimitou o erro ao envio direto do áudio, e o proprietário corrigiu a política de CORS do bucket. Em seguida relatou um Reel publicado. Essa é **validação manual do caminho feliz**, não inspeção do JSON efetivamente salvo na Cloudflare.

A política deve permitir a origem **exata** `https://1ce.lol`, método `PUT` e cabeçalho `Content-Type` na rota de URL assinada. Preservar outras origens necessárias e a restrição de bucket privado; não abrir permissões públicas indiscriminadas. Envio válido: init autenticado → signed PUT → complete → enqueue. `GET /api/publishing/status` 200, isoladamente, não valida o PUT ao R2.

## 3. Segurança Meta compartilhada — NÃO considerar encerrada

**Prioridade P0: deauthorization e data deletion.** A v1 tinha `signed_request` endpoints em `api/instagram/auth.js`, associados ao backend legado. Se as URLs configuradas no Meta ainda apontam para `https://1ce.lol/api/instagram/auth`, essa rota pode não chegar à v1 depois do cutover. **Não foi conferido o painel Meta.** Auditar os endereços reais de **Deauthorize Callback** e **Data Deletion Request URL**; implementar/validar atendimento correto para dados da v1 e da v2. Não devolver sucesso de exclusão se apenas uma das bases foi tratada, nem remover a URL antiga sem substituição válida e teste.

**Prioridade P0: URLs que carregam capacidades.** O worker utiliza URL temporária `/api/publishing/meta-media?token=…` para o fetch da Meta e `GET https://graph.instagram.com/refresh_access_token?access_token=…` para refresh do token de longa duração. Esse último contém credencial em query; a troca é exigida pelo formato atual usado no código, mas não torna seu registro seguro. **Verificar se Railway, ingress, traces, CDN e ferramentas de erro omitem queries sensíveis**. Preferir transporte alternativo sem segredo no URL se o endpoint Meta permitir, e usar testes sintéticos para garantir que não aparecem em logs. A flag e a criptografia não resolvem logs automaticamente.

## 4. Fila, recuperação e testes pendentes

- **Reenvio após refresh:** `pending.current.requestId` no browser é só memória; um reload após timeout ambíguo cria outro ID. O backend só deduplica pedidos com o **mesmo** ID. Precisamos reconciliar histórico antes de reenvio, testar abas e F5 e considerar persistência de intenção por conta sem tokens.
- **Transações/lease:** testar sucesso no provedor seguido de falha ao gravar `remote_id` ou `settlePublicationTarget`, perda de heartbeat, crash antes/depois de `publish_started_at`, desconexão, troca de geração e `needs_review`. Nunca usar retry cego após chamada possivelmente irreversível. A resposta boolean de `settlePublicationTarget` não é verificada no worker Instagram.
- **Cobertura:** a API Graph e entrega `GET/HEAD/Range` possuem testes de contrato com mocks; CI 7/7 não substitui simulação transacional do worker inteiro com DB descartável e falha de rede real. Reels API em conta profissional de teste somente com consentimento para que a publicação seja pública.
- **Resultado:** após publicação confirmada, salvar e conferir ID remoto, consultar permalink Meta por endpoint autorizado e mostrar `Published`/link no histórico. Não inventar URL Instagram a partir do ID do target.
- **App Review:** primeira publicação da conta conectada não prova que o app tem permissões avançadas para outros produtores. Conferir em Meta for Developers antes de oferecer a externos.
- **Runbook operacional:** revisar erros de `instagram_reconnect_required`, `instagram_reel_processing_timeout`, `instagram_claim_expired`, `instagram_publish_needs_review` e `needs_review`; dar opção de reconciliação manual, não republique automaticamente.

Os itens em P0/P1 aparecem detalhados na [revisão da arquitetura de 2026-11-16](architecture.md). Não foram corrigidos nesta atualização documental.

## 5. Como verificar sem causar posts involuntários

1. Confirmar ambiente (domínio v2, origem, credenciais e flag) **sem expor valores secretos**; ver status do Instagram autenticado. Não trocar callback ou segredo na v1.
2. Testar em conta profissional de teste (para um post real, obter consentimento do proprietário antes de clicar Publish). Conexão e seleção da plataforma **não** enviam Reel.
3. Verificar MP3/WAV+capa, SHA, PUT ao R2, fila, geração de MP4, contêiner e `media_publish`. Conferir target `succeeded`, ID e presença pública **uma vez só**.
4. Testar YouTube `Private` com Instagram público no mesmo job, sem cruzar as visibilidades.
5. Com mídia descartável e DB isolado, injetar timeout, restart, expiração de lease e respostas Meta ambíguas. Estado `needs_review` exige revisão humana. Não usar a conta real para simular falhas.
6. Auditar compliance Meta, logs e operação `/meta-media` antes de liberar usuários externos.

## 6. Histórico de marcos (não executar novamente)

- **R1 — 2026-11-15:** conexão OAuth e armazenamento criptografado; inicialmente sem publisher. PR #96; PR #97 corrigiu diagnóstico após consentimento.
- **R2 — 2026-11-15/16:** migration 019, worker Reels e entrega temporária de render, flag de servidor; PR #98 passou CI e foi integrada; posteriormente a publicação foi habilitada no Railway.
- **Validação do proprietário:** um Reel publicado com sucesso após ajuste de CORS; histórico mostrou `Uploaded` (e YouTube 9:16/16:9 também apareceu `Uploaded` em captura). Isso não é validação de toda a matriz de falhas.
- **UI:** PRs #100–#103 alteraram exclusivamente seleção Destinations, `⋯` dos formatos e preview maior. Confirmados merges e Vercel READY da #103.

**Referência externa do provedor:** [Instagram API with Instagram Login — Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) e [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing). Limites e versão Graph API precisam ser reconfirmados em atualizações futuras; não assumir contrato permanente a partir de um Reel.
