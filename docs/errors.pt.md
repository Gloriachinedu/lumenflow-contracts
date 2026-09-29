# Códigos de Erro do Contrato LumenFlow

Este documento lista todos os códigos de erro retornados pelo contrato LumenFlow, junto com suas descrições e passos sugeridos para resolução.

> **Versão original (inglês):** [`docs/errors.md`](errors.md)
> **Versión en español:** [`docs/errors.es.md`](errors.es.md)

## Erros de Autenticação

| Nome do Erro | Código | Descrição | Resolução |
| :--- | :--- | :--- | :--- |
| `Unauthorized` | 1 | O chamador não está autorizado a realizar esta ação. | Certifique-se de que o chamador assinou a transação e possui o papel necessário (ex.: admin, comerciante). |
| `AdminAlreadySet` | 2 | O administrador do contrato já foi inicializado. | A inicialização do admin só pode ocorrer uma vez. |
| `InvalidAdminAddress` | 3 | O endereço de admin fornecido é inválido. | Certifique-se de que um endereço Stellar válido foi passado. |
| `InvalidNonce` | 4 | O nonce fornecido não corresponde ao valor esperado. | Busque o nonce atual e incremente em 1. |

## Erros de Comerciante

| Nome do Erro | Código | Descrição | Resolução |
| :--- | :--- | :--- | :--- |
| `MerchantNotFound` | 10 | O perfil de comerciante solicitado não existe. | Verifique o endereço do comerciante e certifique-se de que ele está registrado. |
| `MerchantAlreadyRegistered` | 11 | Já existe um perfil de comerciante para o endereço fornecido. | Use o perfil existente ou registre-se com um endereço diferente. |
| `MerchantInactive` | 12 | O perfil do comerciante está desativado. | Um administrador deve reativar o perfil do comerciante para retomar as operações. |

## Erros de Pagamento

| Nome do Erro | Código | Descrição | Resolução |
| :--- | :--- | :--- | :--- |
| `PaymentNotFound` | 20 | O pagamento especificado não foi encontrado. | Verifique o ID do pagamento ou o ID do pedido. |
| `PaymentAlreadyExists` | 21 | Já existe um pagamento com o ID de pedido fornecido. | Use um ID de pedido único para cada pagamento. |
| `InvalidAmount` | 22 | O valor do pagamento é zero ou negativo. | Forneça um valor positivo e diferente de zero. |
| `InvalidSignature` | 23 | A assinatura Ed25519 fornecida é inválida ou não corresponde ao payload. | Certifique-se de que o payload foi construído corretamente e assinado com a chave privada correta. |
| `PaymentExpired` | 24 | A solicitação de pagamento expirou. | Crie uma nova solicitação de pagamento. |
| `InsufficientBalance` | 25 | O pagador não possui tokens suficientes para concluir o pagamento. | Certifique-se de que o pagador possui fundos suficientes no token especificado. |
| `TokenNotAllowed` | 26 | O token especificado não é aceito. | Use um token suportado. |

## Erros de Reembolso

| Nome do Erro | Código | Descrição | Resolução |
| :--- | :--- | :--- | :--- |
| `RefundNotFound` | 30 | O reembolso solicitado não foi encontrado. | Verifique o ID do reembolso. |
| `RefundAlreadyExists` | 31 | Já existe um reembolso com o ID fornecido. | Use um ID de reembolso único. |
| `RefundWindowExpired` | 32 | O período permitido para iniciar um reembolso passou. | Os reembolsos devem ser iniciados dentro de 30 dias a partir do pagamento. |
| `RefundExceedsOriginal` | 33 | O valor total do reembolso excede o valor original do pagamento. | Certifique-se de que o valor do reembolso (ou a soma de reembolsos parciais) não ultrapasse o valor original do pagamento. |
| `RefundNotApproved` | 34 | O reembolso ainda não foi aprovado. | O comerciante ou administrador deve aprovar o reembolso antes de ele poder ser executado. |
| `RefundAlreadyCompleted` | 35 | O reembolso já foi executado. | Nenhuma ação é necessária; o reembolso está concluído. |
| `TooManyRefunds` | 36 | O número máximo de reembolsos parciais para um único pagamento foi atingido. | Consolide os valores de reembolso ou resolva fora da cadeia. |
| `RefundNotRejected` | 37 | O reembolso não pode ser contestado porque não foi rejeitado. | Somente reembolsos rejeitados podem ser contestados. |
| `DisputeAlreadyExists` | 38 | Já existe uma contestação para este reembolso. | Verifique o status da contestação existente. |
| `DisputeNotFound` | 39 | A contestação solicitada não foi encontrada. | Verifique o ID do reembolso. |

## Erros de Multi-assinatura

| Nome do Erro | Código | Descrição | Resolução |
| :--- | :--- | :--- | :--- |
| `MultisigNotFound` | 40 | A solicitação de pagamento multi-assinatura não foi encontrada. | Verifique o ID do pagamento. |
| `MultisigAlreadySigned` | 41 | O chamador já assinou este pagamento multi-assinatura. | Aguarde outros signatários obrigatórios. |
| `MultisigAlreadyExecuted` | 42 | O pagamento multi-assinatura já foi executado. | Nenhuma ação é necessária. |
| `InsufficientSignatures` | 43 | O pagamento multi-assinatura não possui o número necessário de assinaturas para ser executado. | Colete mais assinaturas dos signatários autorizados. |

## Erros Gerais

| Nome do Erro | Código | Descrição | Resolução |
| :--- | :--- | :--- | :--- |
| `InvalidInput` | 50 | Os parâmetros de entrada fornecidos são inválidos. | Verifique os valores e o formato dos dados de entrada. |
| `PaginationLimitExceeded` | 51 | O limite solicitado para paginação excede o máximo permitido (100). | Use um limite de 100 ou menos. |
| `BatchSizeExceeded` | 52 | A operação em lote excede o número máximo de itens permitidos. | Reduza o número de itens no lote. |
| `InvalidTags` | 53 | As tags fornecidas excedem os limites de tamanho ou quantidade. | Certifique-se de que as tags estejam dentro dos limites permitidos (ex.: máx. 5 tags, máx. 20 caracteres por tag). |
| `SerializedPayloadTooLarge` | 54 | O payload serializado para um item de lote excede o tamanho máximo permitido (1.024 bytes). | Reduza o tamanho dos campos de memo, order_id ou outros campos de texto no item do lote. |

## Erros de Assinatura

| Nome do Erro | Código | Descrição | Resolução |
| :--- | :--- | :--- | :--- |
| `SubscriptionPlanAlreadyExists` | 60 | Já existe um plano de assinatura com o ID fornecido. | Use um ID de plano único. |
| `SubscriptionAlreadyExists` | 61 | Já existe uma assinatura com o ID fornecido. | Use um ID de assinatura único. |
| `SubscriptionPlanNotFound` | 62 | O plano de assinatura solicitado não foi encontrado. | Verifique o ID do plano. |
| `SubscriptionNotFound` | 63 | A assinatura solicitada não foi encontrada. | Verifique o ID da assinatura. |
| `SubscriptionNotActive` | 64 | A assinatura não está ativa. | Certifique-se de que a assinatura não foi cancelada ou concluída. |
| `SubscriptionMaxCyclesReached` | 65 | A assinatura atingiu o número máximo de ciclos de cobrança. | Crie uma nova assinatura se necessário. |
| `SubscriptionIntervalNotElapsed` | 66 | O intervalo necessário entre cobranças de assinatura ainda não decorreu. | Aguarde o próximo ciclo de cobrança. |

## Cobertura de Regressão

A suíte de regressão em [contracts/lumenflow/src/test_error_codes.rs](../contracts/lumenflow/src/test_error_codes.rs) exercita as principais variantes de erro do contrato com testes direcionados nomeados seguindo o padrão `test_error_{code_name}_is_triggered`.

## Exemplos de Tratamento de Erros

Estes exemplos descrevem os códigos de erro mais comuns do contrato e como resolvê-los em integrações de clientes.

### Assinatura inválida ou problemas com o payload do comerciante

Se o contrato retornar `PaymentError::InvalidSignature` (código `23`), o cliente deve:

- Reconstruir o payload assinado exatamente como o contrato espera.
- Usar a chave privada Ed25519 do comerciante para assinar o payload.
- Verificar se o payload inclui `order_id` e `amount` no formato canônico correto.
- Tentar novamente com uma assinatura nova caso a solicitação original tenha falhado.

### IDs de pedido duplicados

Se o contrato retornar `PaymentError::PaymentAlreadyExists` (código `21`), o cliente deve:

- Gerar um `order_id` único para cada pagamento.
- Evitar reenviar o mesmo `order_id`, a menos que a transação anterior tenha sido confirmada como falha.
- Se o pagamento já foi criado, use o registro existente ou consulte `get_payment_summary`.

### Erros de autorização e papel

Se o contrato retornar `PaymentError::Unauthorized` (código `1`), o cliente deve:

- Garantir que o endereço do chamador é o signatário correto para o ponto de entrada solicitado.
- Confirmar que o chamador é o administrador configurado para chamadas exclusivas do admin.
- Para ações de comerciante, verificar se o endereço do comerciante corresponde ao signatário autenticado.

### Entradas ausentes ou inválidas

Se o contrato retornar `PaymentError::InvalidInput` (código `50`), o cliente deve:

- Confirmar que os campos de texto não estão vazios e estão dentro dos limites de comprimento permitidos.
- Confirmar que os IDs são únicos, não vazios e com no máximo 64 caracteres.
- Confirmar que os valores de `limit` estão entre 1 e 100 para chamadas de paginação.

### Erros de não encontrado

Se o contrato retornar `PaymentError::PaymentNotFound` (código `20`) ou `PaymentError::MerchantNotFound` (código `10`), o cliente deve:

- Verificar se o `order_id` ou o endereço do comerciante solicitado está correto.
- Se for apropriado, registrar novamente o comerciante ou criar a solicitação de pagamento ausente.
- Para chamadas de leitura, apresentar ao usuário uma mensagem amigável informando que o item solicitado não existe.

### Erros de reembolso e ciclo de vida

Se o contrato retornar `PaymentError::RefundWindowExpired` (código `32`), o cliente deve:

- Informar o usuário de que o período de reembolso foi encerrado.
- Oferecer canais de suporte alternativos para resolução manual de disputas.

Se o contrato retornar `PaymentError::RefundExceedsOriginal` (código `33`), o cliente deve:

- Certificar-se de que o valor acumulado de reembolsos não exceda o valor original do pagamento.
- Ajustar a solicitação de reembolso para um valor válido.
