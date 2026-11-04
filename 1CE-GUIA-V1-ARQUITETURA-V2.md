# 1CE — Guia de referência da v1 e arquitetura da v2

> **Guia de referência histórica (estado esclarecido em 2026-11-04 UTC).** Este arquivo preserva o mapa da v1 e o planejamento inicial da v2. Indicações abaixo como `planejado`, `não implementado` ou `pendente` podem estar desatualizadas. Para a estrutura atual, consulte o [índice da documentação](docs/README.md) e a [visão geral do sistema](docs/system-overview.md). A v1 continua estritamente somente leitura.

> **Objetivo:** localizar rapidamente na 1CE v1 a origem de componentes, estilos, comportamentos, regras de interface e integrações solicitadas para a v2.
>
> **REGRA ABSOLUTA:** o repositório `tofdidthat/1ce` (v1) é **somente leitura**. Nunca modificar, publicar, migrar dados ou alterar deploy, banco, tokens, domínios e variáveis da v1.

**Repositório de referência:** `tofdidthat/1ce`  
**Repositório de trabalho:** `tofdidthat/1ce-v2`  
**Atualizado:** novembro de 2026  
**Observação:** caminhos da v1 foram verificados em leitura no GitHub; funcionalidades planejadas não devem ser confundidas com as implementadas.

---

## 1. Plano da v2: profissionalizar, organizar e proteger

A v2 não é apenas uma reformulação visual. Objetivos:

1. **Separar responsabilidades:** UI, autenticação, contas, Library, arquivos, player, publicação e integrações externas.
2. **Isolar infraestrutura:** banco PostgreSQL, sessões, segredos e recursos da v2 sem dependência da v1.
3. **Aumentar a segurança:** autorização por usuário e por recurso, validação no backend, arquivos privados, segredos fora do frontend e tratamento de erros.
4. **Facilitar manutenção:** componentes menores, contratos claros, documentação e testes.
5. **Evoluir em etapas:** autenticação e fundação, interface, domínio, armazenamento, player e publicação.

### Por que TypeScript?

- **Contratos explícitos:** tipos de usuários, sessões, beats, packs, arquivos, permissões, payloads e respostas.
- **Erros antecipados:** o compilador identifica inconsistências antes do deploy.
- **Refatoração mais segura:** renomear, dividir e reutilizar componentes com apoio do editor e do build.
- **Comunicação entre camadas:** contratos e schemas compartilhados reduzem incompatibilidades entre frontend e API.
- **Documentação viva:** tipos explicam o formato esperado de dados e funções.
- **Manutenção em longo prazo:** facilita revisão e evolução do projeto.

**Importante:** TypeScript não substitui validação de dados recebidos da rede, autenticação, autorização, testes nem revisão de segurança.

### Arquitetura: planejado versus existente

| Área | Direção planejada | Situação conhecida |
|---|---|---|
| Monorepo | Web, API, módulos compartilhados e docs | `apps/web`, `apps/api`, `docs`, `history` |
| Web | React + Vite + TypeScript | Implementado; partes da v1 já adaptadas |
| API | Backend modular e tipado | Atualmente Node 22 HTTP nativo em `apps/api/src/server.js`; **a migração da API para TypeScript ainda não aconteceu** |
| Banco | PostgreSQL exclusivo da v2 | Separado na Railway; tabelas de conta, sessão e OAuth |
| Armazenamento | Cloudflare R2 privado, isolado da v1 | Planejado; upload persistente ainda não concluído |
| Contratos | `packages/shared` com tipos/schemas | Planejado; verificar antes de presumir existente |
| Docs | Arquitetura, roadmap, migração, decisões | Evoluir conforme o projeto |
| Publicação | Integrações externas e filas | Fase futura |

### Regras de segurança permanentes

- Nunca compartilhar banco, sessões, OAuth, buckets, credenciais ou tokens com a v1.
- Segredos apenas em variáveis privadas do backend; nunca em commits, frontend ou logs.
- Google Login da v2 separado das integrações Google/YouTube da v1.
- Verificar identidade **e propriedade do recurso** no servidor em cada operação sensível.
- Áudio e capas em storage privado; PostgreSQL armazena metadados, não blobs `BYTEA`.
- Validar extensão, conteúdo/tipo, tamanho e limites no servidor.
- Usar URLs temporárias ou endpoints protegidos para downloads privados.
- Implementar mudanças pequenas, executar build e testar login e rotas.
- Qualquer migração de dados da v1 exige autorização e plano específico de backup e conferência.

---

## 2. Mapa de localização da v1

**Todos os caminhos abaixo pertencem a `tofdidthat/1ce`.**

| O que procurar | Arquivo original | Complementos |
|---|---|---|
| Header do Workspace | `src/workspace/WorkspaceShell.jsx` | `WorkspaceHeader`; CSS embutido |
| Menu interativo Home | `src/workspace/WorkspaceShell.jsx` | `CompactWorkspaceNav`, `HomeMark`, `GlobeMark`, `UploadMark` |
| Botão Settings original | `src/workspace/WorkspaceShell.jsx` | SVG inline no `WorkspaceHeader` |
| Botão Public Profile da header | `src/workspace/WorkspaceShell.jsx` | `library-profile-trigger`; não copiar chamada de API da v1 |
| Library: estrutura, beats, packs, menus, tela vazia | `src/LibraryPage.jsx` | Arquivo grande; buscar `library-items`, `library-empty`, `packOpen` |
| CSS específico da Library | `src/LibraryPage.css` | Cards, menus, packs e abas |
| CSS de perfil e elementos compartilhados | `src/BeatProfile.css` | `.beat-profile`, `.beat-tabs`, cards |
| **Add file** inferior | `src/playback.jsx` | `GlobalQueue`; botão `onece-global-player` |
| CSS do Add file inferior | `src/GlobalPlayer.css` | `.onece-player-dock`, `.onece-global-player` |
| Player inferior completo | `src/GlobalPlayer.jsx` | `src/GlobalPlayer.css`, `src/playback.jsx` |
| Estado e fila do player | `src/playback.jsx` | `playback`, `useSharedPlayback`, `GlobalQueue` |
| Upload para Library | `src/upload/LibraryUploadPage.jsx` | `src/upload/LibraryUploadPage.css`, `src/upload-api.js`, `src/pending-upload.js` |
| Upload/publicação completa | `src/upload/UploadPage.jsx` | FFmpeg e destinos externos; não copiar integrações |
| Painéis de destinos | `src/UploadPanels.jsx` | `src/useUploadDestinations.js`, `src/publication-ui.js` |
| Perfil na área logada | `src/BeatProfile.jsx` | `src/BeatProfile.css` |
| Perfil público | `src/PublicProfilePage.jsx` | `src/PublicProfilePage.css`, `src/SocialProfileLinks.jsx` |
| Editor de perfil | `src/workspace/ProfileEditor.jsx` | `src/workspace/ProfileEditor.css`, `src/profile-api.js` |
| Configurações de conta | `src/AccountPanel.jsx` | `src/AccountPanel.css`, `src/AccountHandle.jsx` |
| Identificador/handle | `src/AccountHandle.jsx` | Também usado em Workspace |
| Discover | `src/workspace/WorkspaceShell.jsx` | `DiscoverPage` definido no arquivo; `src/workspace/DiscoverPage.css` |
| Roteamento | `src/routes/AppRouter.jsx` | `src/routes/routes.js`, `src/routes/guards.js` |
| Favoritos | `src/components/ui/favorite-star-button.tsx` | Usado em Library e BeatProfile |
| Seleção no perfil | `src/useProfileSelection.js` | `src/profile-api.js` |
| Cliente da API de perfil | `src/profile-api.js` | Estudar endpoints, **não reutilizar URLs/sessões** |
| Cliente de upload | `src/upload-api.js` | Mapear endpoints antes de criar equivalentes na v2 |
| URLs e chaves de configuração | `src/config.js` | **Somente referência histórica** |

### Onde estavam os botões solicitados

**Header e Home:**

```text
src/workspace/WorkspaceShell.jsx
  ├── HomeMark / GlobeMark / UploadMark
  ├── CompactWorkspaceNav
  │   ├── Home
  │   ├── Discover
  │   ├── Upload
  │   └── interação: clique, hover, teclado, Escape, clique fora
  └── WorkspaceHeader
      ├── logo 1CE
      ├── menu Home
      ├── Public Profile
      └── Settings (botão independente na v1)
```

**Diferença aprovada para a v2:** somente **Home** e **Public Profile** na header. Menu Home com **Home → Discover → Upload → Settings**; Settings deve ser a última opção.

**Add file inferior:**

```text
src/playback.jsx
  └── GlobalQueue
      └── quando não há faixa ativa e a view é Library:
          .onece-player-dock
            └── .onece-global-player (ícone +, "Add file")

src/GlobalPlayer.css
  ├── .onece-player-dock (fixo na parte inferior)
  └── .onece-global-player (cápsula, fundo, borda, sombra)
```

Na v1, o Add file **navega para Upload**. Não confundir o botão inferior com o seletor de arquivos dentro da página de upload.

**Library:**

```text
src/LibraryPage.jsx
  ├── biblioteca, beats, packs, ações e estados vazios
  ├── playback e dados do perfil
  └── estilos: LibraryPage.css + BeatProfile.css
```

**Diferença aprovada para a v2:** a divisão **Beats / Packs** foi removida. **Não reintroduzir as abas**.

---

## 3. Mapa da v2 atual

**Caminhos relativos a `tofdidthat/1ce-v2`.**

| Responsabilidade | Arquivo |
|---|---|
| Rotas React, proteção de Library e retorno Google | `apps/web/src/main.tsx` |
| Header, Home, Library inicial, Add file adaptados | `apps/web/src/workspace-v1.tsx` |
| CSS do Workspace e Library inicial | `apps/web/src/workspace-v1.css` |
| Estilos globais | `apps/web/src/styles.css` |
| Login frontend / início OAuth | `apps/web/src/login.tsx` |
| Tipos de ambiente Vite | `apps/web/src/vite-env.d.ts` |
| API e autenticação atual | `apps/api/src/server.js` |
| Schema inicial de contas | `history/database/001_auth_initial_schema.sql` |
| Schema das tentativas Google OAuth | `history/database/002_google_oauth_schema.sql` |
| Rewrites SPA da Vercel | `apps/web/vercel.json` |

Rotas do Workspace v2:

- `/app/library`: Library.
- `/app/discover`: Discover, conteúdo ainda pendente.
- `/app/upload`: seleção local; persistência ainda pendente.
- `/app/settings`: Settings, conteúdo ainda pendente.
- `/app/profile`: Public Profile, conteúdo ainda pendente.

**Uma rota existente não significa que a funcionalidade esteja completa.**

---

## 4. Procedimento para futuras solicitações

1. Identificar se o pedido é **visual, interação, dados, autenticação, player, upload, perfil ou publicação**.
2. Consultar o mapa acima e ler o arquivo principal da **v1 somente em leitura**.
3. Localizar componente, JSX/SVG, classes CSS, handlers, estados, hooks e rotas reais.
4. Seguir imports e dependências até identificar endpoints e efeitos colaterais.
5. Localizar a implementação correspondente na v2 e evitar duplicação.
6. Registrar as **diferenças intencionais** já aprovadas (Settings no Home; sem Beats/Packs).
7. Migrar JSX, SVG e CSS quando apropriado; adaptar interações locais; **substituir qualquer API da v1 por contrato próprio da v2**.
8. Testar build TypeScript/Vite, login Google, rotas diretas, desktop/mobile, teclado e ausência de chamadas a serviços da v1.
9. Atualizar este guia com caminhos e comportamentos novos **confirmados**, sem inventar implementações.

### Modelo para novas descobertas

```md
### [Nome da funcionalidade]
- Pedido:
- v1 — arquivo:
- v1 — componente/função:
- v1 — CSS e assets:
- Comportamento original:
- Dependências da v1 (somente para estudar):
- v2 — destino:
- Diferenças intencionais:
- Implementado:
- Pendente:
- Testes:
```

### Buscas rápidas no GitHub

| Pedido | Pesquisar |
|---|---|
| Home / header | `CompactWorkspaceNav`, `WorkspaceHeader` |
| Foto de perfil na header | `library-profile-trigger` |
| Settings | `Settings`, `onNavigate('account')` |
| Add file inferior | `GlobalQueue`, `Add file`, `onece-player-dock` |
| Player | `GlobalPlayer`, `useSharedPlayback` |
| Library vazia | `Your Library is Empty`, `library-empty` |
| Beats e packs | `LibraryPage`, `beat-pack-grid`, `packOpen` |
| Upload | `LibraryUploadPage`, `UploadPage`, `pending-upload` |
| Perfil público | `PublicProfilePage`, `BeatProfile`, `ProfileEditor` |
| Conta | `AccountPanel`, `AccountHandle` |

---

## 5. Ordem recomendada de evolução da v2

**Fase A — Fundação e segurança:** isolamento, autenticação, contratos, validação, logs seguros, migrações e testes.

**Fase B — Interface e componentes:** header, Library, navegação, perfil, player, acessibilidade e estados vazios.

**Fase C — Domínio e banco:** usuários, beats, packs, propriedade, permissões e metadados.

**Fase D — Arquivos privados:** R2 isolado, upload autenticado, validações, download protegido e tratamento de falhas.

**Fase E — Catálogo:** CRUD, busca, player, capas, favoritos e perfis.

**Fase F — Publicação:** destinos externos, integrações, autorização, filas, retries e observabilidade.

> **Não confundir fidelidade visual ou um botão funcionando com backend pronto.**

---

## 6. Limites e regra permanente

Os caminhos principais da v1 foram conferidos, mas **não representam auditoria completa** de todos os módulos e endpoints. Arquivos grandes como `LibraryPage.jsx`, `BeatProfile.jsx` e `UploadPage.jsx` precisam de leitura pontual antes de cada migração.

**Regra curta:** antes de recriar algo da v1, localizar o arquivo original neste guia, ler o código real e os estilos, copiar somente o necessário para a v2, preservar mudanças aprovadas, nunca reutilizar infraestrutura da v1 e verificar o build.
