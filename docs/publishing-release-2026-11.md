# Publicação e recuperação — novembro de 2026

A [PR #105](https://github.com/tofdidthat/1ce-v2/pull/105) foi integrada em `8e280046`. A Web no Vercel e a API no Railway foram verificadas após o deploy. A Web servia o bundle atualizado e a API respondeu com sucesso em `/health`. O CI da main passou em [7 verificações](https://github.com/tofdidthat/1ce-v2/actions/runs/43954039654).

- A interface recupera o andamento após recarregar a página. A reconciliação de uma confirmação ambígua do Instagram não tenta publicar outra vez.
- O fluxo de exclusão valida autorização e callbacks, trata falhas ao excluir objetos no R2 e preserva conta, originais e outros destinos. Identidades sem vínculo histórico verificável exigem resolução antes da liberação do fluxo para o caso afetado.
- O deploy automático do Railway foi restabelecido. O teste de saúde não certifica as migrações 020/021 individualmente. A auditoria direta das migrações, o painel Meta, os logs internos do Vercel e o inventário completo de identidades históricas ficaram fora da verificação.
- A [PR #106](https://github.com/tofdidthat/1ce-v2/pull/106) está aberta para a base de OAuth do TikTok. Não faz parte do deploy verificado da PR #105.

Consulte também [a etapa inicial da integração Instagram](instagram-integration.md).
