# TikTok na 1CE v2

O TikTok usa a tela Destinations e a fila de publicação da 1CE. A integração reaproveita o render de MP4, o armazenamento privado R2 e o histórico por destino. O Direct Post fica desativado por padrão.

## Configuração

- Login Kit Web com callback `https://1ce-v2-production.up.railway.app/auth/tiktok/callback`.
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` e `TIKTOK_REDIRECT_URI` são configurações privadas do backend.
- `TIKTOK_DIRECT_POST_ENABLED` controla a publicação. Antes de ativá-la, confirme que o app tem Content Posting API com Direct Post e que o usuário concedeu `video.publish`.
- `TIKTOK_VERIFIED_URL_PREFIX` identifica o prefixo HTTPS verificado no portal TikTok. O TikTok busca o MP4 por uma URL temporária de um único artefato. Mantenha o bucket privado.
- `TIKTOK_AUDITED` só pode ser ativado após aprovação da auditoria do TikTok. Antes disso, o Direct Post se limita a contas privadas e a `SELF_ONLY`. O TikTok também limita clientes não auditados a cinco usuários que publicam por janela de 24 horas.

## Conexão e publicação

`POST /api/publishing/tiktok/connect` inicia a conexão autenticada. `GET /auth/tiktok/start` redireciona ao TikTok e `GET /auth/tiktok/callback` consome o state de uso único, com prazo de validade e vínculo à sessão. A troca e renovação de tokens são feitas no backend com armazenamento criptografado. `POST /api/publishing/tiktok/disconnect` remove a conexão local e solicita a revogação ao provedor.

`GET /api/publishing/tiktok/creator-info` fornece o perfil e os limites atuais. O criador escolhe a privacidade, revisa as opções e consente antes do envio. O job vincula a escolha à geração da conexão para evitar enviar a outra conta após reconexão.

O worker renderiza a mídia, inicia Direct Post e consulta o resultado pelo `publish_id`. Uma falha de resultado incerto exige reconciliação com o provedor. Quando a confirmação é impossível, o destino fica em `needs_review` e exige verificação antes de uma nova tentativa. Consulte o histórico por destino para avaliar publicações combinadas.

## Validação e rollback

Use contas, credenciais e mídia de teste para comprovar consentimento e publicação. A aprovação de `video.publish`, o prefixo verificado e a publicação real ainda precisam ser confirmados no ambiente de teste. Mocks e CI não comprovam aprovação do TikTok.

Para suspender o recurso, desative o Direct Post e confira os destinos em trânsito e em revisão antes de qualquer reenvio. Se for necessário reverter o código, reverta o commit via PR e preserve as tabelas aditivas para investigação e histórico. Uma publicação já processada pelo TikTok não é desfeita por rollback da 1CE.

- [Diretrizes de compartilhamento](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [Informações do criador](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info)
- [Status do post](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)
