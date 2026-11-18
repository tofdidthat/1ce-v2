# Rascunhos do TikTok na 1CE v2

O destino TikTok envia um vídeo para a caixa de entrada do criador. Abra a notificação no TikTok para editar e publicar. A 1CE reaproveita a fila de publicação, o render vertical de MP4 de imagem e áudio, o R2 privado e o histórico por destino.

## Configuração

- Login Kit Web com callback `https://1ce-v2-production.up.railway.app/auth/tiktok/callback`.
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` e `TIKTOK_REDIRECT_URI` são configurações privadas da API.
- O Login Kit solicita `user.info.basic` para identificar a conta e `video.upload` para enviar rascunhos. A conta precisa conceder ambos.
- `TIKTOK_DRAFT_UPLOAD_ENABLED` habilita o envio. Para ativar, use `true` e confira as permissões do app no TikTok.
- O domínio `1ce.lol` está verificado no TikTok. O Vercel encaminha exclusivamente `/api/publishing/tiktok-media` ao backend do Railway. Para outra instalação, configure `TIKTOK_VERIFIED_URL_PREFIX` com o prefixo HTTPS verificado que cobre essa rota. O TikTok recebe uma URL temporária de um único MP4 derivado. O bucket R2 permanece privado.

## Conexão e envio

`POST /api/publishing/tiktok/connect` inicia a conexão autenticada. `GET /auth/tiktok/start` redireciona ao TikTok e `GET /auth/tiktok/callback` consome o state de uso único, com prazo de validade e vínculo à sessão. A troca e a renovação de tokens são feitas no backend com armazenamento criptografado. `POST /api/publishing/tiktok/disconnect` remove a conexão local e solicita revogação ao provedor.

O envio exige confirmação explícita vinculada à geração da conta conectada. O worker renderiza o vídeo, registra um checkpoint e solicita um upload para a caixa de entrada. O `publish_id` identifica a solicitação de upload e é usado para consultar seu estado. `SEND_TO_USER_INBOX` confirma a entrega do rascunho. Em caso de resultado incerto, o worker consulta o mesmo identificador quando disponível. Se a confirmação for impossível, o destino fica em `needs_review` e exige verificação antes de uma nova tentativa.

## Validação e rollback

Use uma conta de teste e mídia autorizada para confirmar que a notificação chega à caixa de entrada. A verificação vai até a entrega do rascunho. Para suspender o recurso, desative `TIKTOK_DRAFT_UPLOAD_ENABLED` e revise os destinos em trânsito ou em revisão. Se precisar reverter o código, reverta o commit via PR e preserve as tabelas aditivas para investigação e histórico.

- [Upload de vídeo para a caixa de entrada](https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video)
- [Status do upload](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)
